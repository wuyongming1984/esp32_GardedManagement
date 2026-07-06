#include "nursery_mqtt.h"

#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "esp_log.h"
#include "esp_heap_caps.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "mqtt_client.h"
#include "nursery_camera.h"
#include "nursery_irrigation.h"
#include "nursery_ui.h"
#include "nursery_wifi.h"

static const char *TAG = "nursery_mqtt";
#define NURSERY_MQTT_FRAME_MAX (512 * 1024)
#define NURSERY_MQTT_FRAME_INTERVAL_MS 1000
static esp_mqtt_client_handle_t s_client;
static nursery_config_t s_config;
static bool s_mqtt_connected;
static bool s_frame_task_started;

static void mjpeg_frame_publish_task(void *arg)
{
    (void)arg;
    uint8_t *frame = heap_caps_malloc(NURSERY_MQTT_FRAME_MAX, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    if (!frame) {
        ESP_LOGE(TAG, "mjpeg relay buffer alloc failed");
        s_frame_task_started = false;
        vTaskDelete(NULL);
        return;
    }

    uint32_t last_seq = 0;
    char topic[160];
    snprintf(topic, sizeof(topic), "devices/%s/video/mjpeg", s_config.device_id);

    while (true) {
        if (s_mqtt_connected) {
            size_t frame_size = 0;
            uint32_t seq = 0;
            esp_err_t err = nursery_camera_copy_latest_jpeg(frame, NURSERY_MQTT_FRAME_MAX, &frame_size, &seq);
            if (err == ESP_OK && seq != last_seq) {
                int msg_id = esp_mqtt_client_publish(s_client, topic, (const char *)frame, (int)frame_size, 0, 0);
                if (msg_id >= 0) {
                    last_seq = seq;
                    ESP_LOGI(TAG, "published mjpeg frame seq=%" PRIu32 " bytes=%u", seq, (unsigned)frame_size);
                } else {
                    ESP_LOGW(TAG, "mjpeg frame publish failed seq=%" PRIu32, seq);
                }
            } else if (err == ESP_ERR_INVALID_SIZE) {
                ESP_LOGW(TAG, "mjpeg frame too large for mqtt relay");
            }
        }
        vTaskDelay(pdMS_TO_TICKS(NURSERY_MQTT_FRAME_INTERVAL_MS));
    }
}

static void publish_event(const char *event, const char *detail)
{
    if (!s_client) {
        return;
    }
    char topic[128];
    char payload[256];
    snprintf(topic, sizeof(topic), "devices/%s/events", s_config.device_id);
    snprintf(payload, sizeof(payload), "{\"event\":\"%s\",\"detail\":\"%s\"}", event, detail ? detail : "");
    esp_mqtt_client_publish(s_client, topic, payload, 0, 1, 0);
}

void nursery_mqtt_publish_status(void)
{
    if (!s_client) {
        return;
    }
    char topic[128];
    char payload[320];
    const char *ip_text = nursery_wifi_current_ip();
    snprintf(topic, sizeof(topic), "devices/%s/status", s_config.device_id);
    snprintf(
        payload,
        sizeof(payload),
        "{\"status\":\"online\",\"irrigationState\":\"%s\",\"localIp\":\"%s\",\"mjpegUrl\":\"http://%s:8080/stream.mjpg\"}",
        nursery_irrigation_state() == NURSERY_IRRIGATION_ON ? "on" : "off",
        ip_text,
        ip_text
    );
    esp_mqtt_client_publish(s_client, topic, payload, 0, 1, 1);
}

static uint32_t parse_duration_sec(const char *payload)
{
    const char *key = strstr(payload, "durationSec");
    if (!key) {
        return 0;
    }
    const char *colon = strchr(key, ':');
    if (!colon) {
        return 0;
    }
    return (uint32_t)atoi(colon + 1);
}

static void mqtt_event_handler(void *args, esp_event_base_t base, int32_t event_id, void *event_data)
{
    (void)args;
    (void)base;
    esp_mqtt_event_handle_t event = event_data;

    if (event_id == MQTT_EVENT_CONNECTED) {
        char command_topic[160];
        snprintf(command_topic, sizeof(command_topic), "devices/%s/commands/irrigation/+", s_config.device_id);
        esp_mqtt_client_subscribe(s_client, command_topic, 1);
        s_mqtt_connected = true;
        nursery_ui_set_mqtt_status(true);
        nursery_mqtt_publish_status();
        publish_event("device.connected", "mqtt connected");
        return;
    }

    if (event_id == MQTT_EVENT_DISCONNECTED) {
        s_mqtt_connected = false;
        nursery_ui_set_mqtt_status(false);
        nursery_irrigation_safe_off("mqtt disconnected");
        return;
    }

    if (event_id == MQTT_EVENT_DATA) {
        char payload[192] = {0};
        size_t copy_len = event->data_len < sizeof(payload) - 1 ? event->data_len : sizeof(payload) - 1;
        memcpy(payload, event->data, copy_len);
        uint32_t duration_sec = parse_duration_sec(payload);
        if (nursery_irrigation_start_limited(duration_sec) == ESP_OK) {
            publish_event("irrigation.running", payload);
        } else {
            nursery_irrigation_safe_off("invalid irrigation command");
            publish_event("irrigation.rejected", payload);
        }
        nursery_mqtt_publish_status();
    }
}

esp_err_t nursery_mqtt_start(const nursery_config_t *config)
{
    s_config = *config;
    ESP_LOGI(TAG, "starting MQTT client uri=%s device_id=%s", s_config.mqtt_uri, s_config.device_id);
    esp_mqtt_client_config_t mqtt_cfg = {
        .broker.address.uri = s_config.mqtt_uri,
        .credentials.username = s_config.device_id,
        .credentials.authentication.password = s_config.device_secret,
    };
    s_client = esp_mqtt_client_init(&mqtt_cfg);
    esp_mqtt_client_register_event(s_client, ESP_EVENT_ANY_ID, mqtt_event_handler, NULL);
    if (!s_frame_task_started) {
        BaseType_t task = xTaskCreatePinnedToCore(
            mjpeg_frame_publish_task,
            "mqtt_mjpeg_relay",
            6144,
            NULL,
            3,
            NULL,
            0);
        if (task == pdPASS) {
            s_frame_task_started = true;
        } else {
            ESP_LOGW(TAG, "mjpeg relay task create failed");
        }
    }
    return esp_mqtt_client_start(s_client);
}
