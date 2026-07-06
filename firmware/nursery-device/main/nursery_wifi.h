#pragma once

#include <stdbool.h>
#include <stdint.h>
#include "esp_err.h"
#include "nursery_config.h"

#define NURSERY_WIFI_MAX_APS 16

typedef struct {
    char ssid[33];
    int8_t rssi;
    bool auth_required;
} nursery_wifi_ap_t;

typedef void (*nursery_wifi_status_cb_t)(bool connected, const char *ssid, const char *ip_text, void *user_ctx);

esp_err_t nursery_wifi_start(const nursery_config_t *config, nursery_wifi_status_cb_t status_cb, void *user_ctx);
esp_err_t nursery_wifi_scan(nursery_wifi_ap_t *aps, uint16_t *count);
esp_err_t nursery_wifi_connect_and_save(const char *ssid, const char *password);
bool nursery_wifi_is_connected(void);
const char *nursery_wifi_current_ip(void);
