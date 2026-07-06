#include "nursery_wifi.h"

#include <string.h>
#include "esp_check.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/task.h"
#include "nursery_irrigation.h"

static const char *TAG = "nursery_wifi";

#define WIFI_CONNECTED_BIT BIT0

static EventGroupHandle_t s_wifi_event_group;
static esp_netif_t *s_sta_netif;
static nursery_config_t s_config;
static nursery_wifi_status_cb_t s_status_cb;
static void *s_status_ctx;
static char s_ip_text[16] = "0.0.0.0";
static bool s_started;

static void publish_status(bool connected)
{
    if (s_status_cb) {
        s_status_cb(connected, s_config.wifi_ssid, connected ? s_ip_text : "0.0.0.0", s_status_ctx);
    }
}

static void wifi_event_handler(void *arg, esp_event_base_t event_base, int32_t event_id, void *event_data)
{
    (void)arg;
    if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_DISCONNECTED) {
        if (s_wifi_event_group) {
            xEventGroupClearBits(s_wifi_event_group, WIFI_CONNECTED_BIT);
        }
        strlcpy(s_ip_text, "0.0.0.0", sizeof(s_ip_text));
        nursery_irrigation_safe_off("wifi disconnected");
        publish_status(false);
        if (s_started && strlen(s_config.wifi_ssid) > 0) {
            esp_wifi_connect();
        }
        return;
    }

    if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) {
        const ip_event_got_ip_t *event = (const ip_event_got_ip_t *)event_data;
        snprintf(s_ip_text, sizeof(s_ip_text), IPSTR, IP2STR(&event->ip_info.ip));
        ESP_LOGI(TAG, "wifi got ip: %s", s_ip_text);
        if (s_wifi_event_group) {
            xEventGroupSetBits(s_wifi_event_group, WIFI_CONNECTED_BIT);
        }
        publish_status(true);
    }
}

static esp_err_t apply_wifi_config(const char *ssid, const char *password)
{
    wifi_config_t wifi_config = {0};
    strlcpy((char *)wifi_config.sta.ssid, ssid ? ssid : "", sizeof(wifi_config.sta.ssid));
    strlcpy((char *)wifi_config.sta.password, password ? password : "", sizeof(wifi_config.sta.password));
    wifi_config.sta.threshold.authmode = WIFI_AUTH_WPA2_PSK;
    wifi_config.sta.scan_method = WIFI_ALL_CHANNEL_SCAN;
    return esp_wifi_set_config(WIFI_IF_STA, &wifi_config);
}

esp_err_t nursery_wifi_start(const nursery_config_t *config, nursery_wifi_status_cb_t status_cb, void *user_ctx)
{
    s_config = *config;
    s_status_cb = status_cb;
    s_status_ctx = user_ctx;

    esp_err_t err = esp_netif_init();
    if (err != ESP_OK && err != ESP_ERR_INVALID_STATE) {
        return err;
    }
    err = esp_event_loop_create_default();
    if (err != ESP_OK && err != ESP_ERR_INVALID_STATE) {
        return err;
    }

    if (!s_sta_netif) {
        s_sta_netif = esp_netif_create_default_wifi_sta();
    }
    if (!s_wifi_event_group) {
        s_wifi_event_group = xEventGroupCreate();
        ESP_RETURN_ON_FALSE(s_wifi_event_group != NULL, ESP_ERR_NO_MEM, TAG, "wifi event group alloc failed");
    }

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_RETURN_ON_ERROR(esp_wifi_init(&cfg), TAG, "esp_wifi_init failed");
    ESP_RETURN_ON_ERROR(esp_event_handler_instance_register(WIFI_EVENT, ESP_EVENT_ANY_ID, wifi_event_handler, NULL, NULL), TAG, "wifi handler failed");
    ESP_RETURN_ON_ERROR(esp_event_handler_instance_register(IP_EVENT, IP_EVENT_STA_GOT_IP, wifi_event_handler, NULL, NULL), TAG, "ip handler failed");
    ESP_RETURN_ON_ERROR(esp_wifi_set_mode(WIFI_MODE_STA), TAG, "wifi mode failed");
    ESP_RETURN_ON_ERROR(apply_wifi_config(s_config.wifi_ssid, s_config.wifi_password), TAG, "wifi config failed");
    ESP_RETURN_ON_ERROR(esp_wifi_start(), TAG, "wifi start failed");
    s_started = true;
    publish_status(false);

    if (strlen(s_config.wifi_ssid) == 0) {
        ESP_LOGW(TAG, "wifi_ssid is empty; screen provisioning is available");
        return ESP_OK;
    }

    ESP_RETURN_ON_ERROR(esp_wifi_connect(), TAG, "wifi connect failed");
    EventBits_t bits = xEventGroupWaitBits(
        s_wifi_event_group,
        WIFI_CONNECTED_BIT,
        pdFALSE,
        pdFALSE,
        pdMS_TO_TICKS(30000));
    if ((bits & WIFI_CONNECTED_BIT) == 0) {
        ESP_LOGW(TAG, "wifi did not get IP within 30 seconds");
    }
    return ESP_OK;
}

esp_err_t nursery_wifi_scan(nursery_wifi_ap_t *aps, uint16_t *count)
{
    ESP_RETURN_ON_FALSE(aps != NULL && count != NULL && *count > 0, ESP_ERR_INVALID_ARG, TAG, "invalid scan args");

    uint16_t max_count = *count;
    *count = 0;
    wifi_scan_config_t scan_config = {
        .show_hidden = false,
    };
    ESP_LOGI(TAG, "wifi scan start");
    esp_err_t err = esp_wifi_scan_start(&scan_config, true);
    if (err == ESP_ERR_WIFI_STATE) {
        ESP_LOGW(TAG, "wifi scan busy, retrying once");
        vTaskDelay(pdMS_TO_TICKS(1500));
        err = esp_wifi_scan_start(&scan_config, true);
    }
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "wifi scan start failed: %s", esp_err_to_name(err));
        return err;
    }

    uint16_t record_count = 32;
    wifi_ap_record_t records[32] = {0};
    ESP_RETURN_ON_ERROR(esp_wifi_scan_get_ap_records(&record_count, records), TAG, "scan get records failed");
    ESP_LOGI(TAG, "wifi scan records=%u", record_count);

    for (uint16_t i = 0; i < record_count && *count < max_count; i++) {
        if (records[i].ssid[0] == '\0') {
            continue;
        }
        bool duplicate = false;
        for (uint16_t j = 0; j < *count; j++) {
            if (strcmp(aps[j].ssid, (const char *)records[i].ssid) == 0) {
                duplicate = true;
                if (records[i].rssi > aps[j].rssi) {
                    aps[j].rssi = records[i].rssi;
                    aps[j].auth_required = records[i].authmode != WIFI_AUTH_OPEN;
                }
                break;
            }
        }
        if (duplicate) {
            continue;
        }
        strlcpy(aps[*count].ssid, (const char *)records[i].ssid, sizeof(aps[*count].ssid));
        aps[*count].rssi = records[i].rssi;
        aps[*count].auth_required = records[i].authmode != WIFI_AUTH_OPEN;
        (*count)++;
    }
    ESP_LOGI(TAG, "wifi scan usable aps=%u", *count);
    return ESP_OK;
}

esp_err_t nursery_wifi_connect_and_save(const char *ssid, const char *password)
{
    ESP_RETURN_ON_FALSE(ssid != NULL && strlen(ssid) > 0, ESP_ERR_INVALID_ARG, TAG, "ssid is empty");

    strlcpy(s_config.wifi_ssid, ssid, sizeof(s_config.wifi_ssid));
    strlcpy(s_config.wifi_password, password ? password : "", sizeof(s_config.wifi_password));
    xEventGroupClearBits(s_wifi_event_group, WIFI_CONNECTED_BIT);
    strlcpy(s_ip_text, "0.0.0.0", sizeof(s_ip_text));
    publish_status(false);

    esp_wifi_disconnect();
    ESP_RETURN_ON_ERROR(apply_wifi_config(s_config.wifi_ssid, s_config.wifi_password), TAG, "apply wifi config failed");
    ESP_RETURN_ON_ERROR(esp_wifi_connect(), TAG, "wifi connect failed");

    EventBits_t bits = xEventGroupWaitBits(
        s_wifi_event_group,
        WIFI_CONNECTED_BIT,
        pdFALSE,
        pdFALSE,
        pdMS_TO_TICKS(20000));
    ESP_RETURN_ON_FALSE((bits & WIFI_CONNECTED_BIT) != 0, ESP_ERR_TIMEOUT, TAG, "wifi connect timed out");
    ESP_RETURN_ON_ERROR(nursery_config_save_wifi(s_config.wifi_ssid, s_config.wifi_password), TAG, "save wifi failed");
    publish_status(true);
    return ESP_OK;
}

bool nursery_wifi_is_connected(void)
{
    if (!s_wifi_event_group) {
        return false;
    }
    return (xEventGroupGetBits(s_wifi_event_group) & WIFI_CONNECTED_BIT) != 0;
}

const char *nursery_wifi_current_ip(void)
{
    return s_ip_text;
}
