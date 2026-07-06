#pragma once

#include <stdint.h>
#include "esp_err.h"

#define NURSERY_MAX_DEVICE_ID_LEN 64
#define NURSERY_MAX_SECRET_LEN 96
#define NURSERY_DEFAULT_IRRIGATION_GPIO 21

typedef struct {
    char device_id[NURSERY_MAX_DEVICE_ID_LEN];
    char device_secret[NURSERY_MAX_SECRET_LEN];
    char mqtt_uri[160];
    char wifi_ssid[64];
    char wifi_password[64];
    int32_t irrigation_gpio;
} nursery_config_t;

esp_err_t nursery_config_load(nursery_config_t *config);
esp_err_t nursery_config_save_wifi(const char *ssid, const char *password);
