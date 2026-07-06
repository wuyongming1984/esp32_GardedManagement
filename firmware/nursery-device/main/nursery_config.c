#include "nursery_config.h"

#include <string.h>
#include "esp_err.h"
#include "nvs.h"
#include "nvs_flash.h"

#define NURSERY_DEFAULT_MQTT_URI "mqtt://8.153.162.62:1883"
static void read_nvs_string(nvs_handle_t handle, const char *key, char *target, size_t target_len, const char *fallback)
{
    size_t len = target_len;
    if (nvs_get_str(handle, key, target, &len) != ESP_OK) {
        strlcpy(target, fallback, target_len);
    }
}

esp_err_t nursery_config_load(nursery_config_t *config)
{
    memset(config, 0, sizeof(*config));
    config->irrigation_gpio = NURSERY_DEFAULT_IRRIGATION_GPIO;

    nvs_handle_t handle;
    esp_err_t err = nvs_open("nursery", NVS_READONLY, &handle);
    if (err != ESP_OK) {
        strlcpy(config->device_id, "device-north-01", sizeof(config->device_id));
        strlcpy(config->device_secret, "dev-secret-change-me", sizeof(config->device_secret));
        strlcpy(config->mqtt_uri, NURSERY_DEFAULT_MQTT_URI, sizeof(config->mqtt_uri));
        return ESP_OK;
    }

    read_nvs_string(handle, "device_id", config->device_id, sizeof(config->device_id), "device-north-01");
    read_nvs_string(handle, "device_secret", config->device_secret, sizeof(config->device_secret), "dev-secret-change-me");
    strlcpy(config->mqtt_uri, NURSERY_DEFAULT_MQTT_URI, sizeof(config->mqtt_uri));
    read_nvs_string(handle, "wifi_ssid", config->wifi_ssid, sizeof(config->wifi_ssid), "");
    read_nvs_string(handle, "wifi_pass", config->wifi_password, sizeof(config->wifi_password), "");
    nvs_get_i32(handle, "water_gpio", &config->irrigation_gpio);
    nvs_close(handle);
    return ESP_OK;
}

esp_err_t nursery_config_save_wifi(const char *ssid, const char *password)
{
    nvs_handle_t handle;
    esp_err_t err = nvs_open("nursery", NVS_READWRITE, &handle);
    if (err != ESP_OK) {
        return err;
    }

    err = nvs_set_str(handle, "wifi_ssid", ssid ? ssid : "");
    if (err == ESP_OK) {
        err = nvs_set_str(handle, "wifi_pass", password ? password : "");
    }
    if (err == ESP_OK) {
        err = nvs_commit(handle);
    }
    nvs_close(handle);
    return err;
}
