#pragma once

#include <stdint.h>
#include "esp_err.h"

typedef void (*nursery_camera_frame_cb_t)(const uint8_t *rgb565, uint32_t width, uint32_t height, void *user_ctx);

esp_err_t nursery_camera_init(void);
esp_err_t nursery_camera_start_video_publish(const char *mode);
void nursery_camera_set_frame_callback(nursery_camera_frame_cb_t callback, void *user_ctx);
