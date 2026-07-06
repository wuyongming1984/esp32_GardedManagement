#pragma once

#include <stdbool.h>
#include <stdint.h>
#include "esp_err.h"
#include "nursery_config.h"

esp_err_t nursery_ui_init(const nursery_config_t *config);
void nursery_ui_request_wifi_scan(void);
void nursery_ui_set_wifi_status(bool connected, const char *ssid, const char *ip_text);
void nursery_ui_set_mqtt_status(bool connected);
void nursery_ui_set_camera_status(const char *text);
void nursery_ui_show_pc_irrigation(uint32_t duration_sec);
void nursery_ui_camera_frame(const uint8_t *rgb565, uint32_t width, uint32_t height, void *user_ctx);
