#pragma once

#include <stdint.h>
#include "esp_err.h"

typedef enum {
    NURSERY_IRRIGATION_OFF = 0,
    NURSERY_IRRIGATION_ON = 1
} nursery_irrigation_state_t;

esp_err_t nursery_irrigation_init(int gpio_num);
esp_err_t nursery_irrigation_start_limited(uint32_t duration_sec);
void nursery_irrigation_safe_off(const char *reason);
nursery_irrigation_state_t nursery_irrigation_state(void);
uint32_t nursery_irrigation_remaining_sec(void);
