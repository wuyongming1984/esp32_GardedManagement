#include "nursery_irrigation.h"

#include "driver/gpio.h"
#include "esp_check.h"
#include "esp_log.h"
#include "esp_timer.h"

static const char *TAG = "nursery_irrigation";
static int s_gpio_num = -1;
static esp_timer_handle_t s_timer;
static nursery_irrigation_state_t s_state = NURSERY_IRRIGATION_OFF;
static int64_t s_end_time_us;

static void timer_safe_off(void *arg)
{
    (void)arg;
    nursery_irrigation_safe_off("duration elapsed");
}

esp_err_t nursery_irrigation_init(int gpio_num)
{
    s_gpio_num = gpio_num;
    gpio_config_t config = {
        .pin_bit_mask = 1ULL << gpio_num,
        .mode = GPIO_MODE_OUTPUT,
        .pull_up_en = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_ENABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    ESP_RETURN_ON_ERROR(gpio_config(&config), TAG, "gpio_config failed");
    nursery_irrigation_safe_off("boot");

    const esp_timer_create_args_t timer_args = {
        .callback = timer_safe_off,
        .name = "irrigation_safe_off",
    };
    return esp_timer_create(&timer_args, &s_timer);
}

esp_err_t nursery_irrigation_start_limited(uint32_t duration_sec)
{
    if (duration_sec == 0 || duration_sec > 900) {
        ESP_LOGW(TAG, "rejecting invalid duration %lu", (unsigned long)duration_sec);
        return ESP_ERR_INVALID_ARG;
    }
    ESP_RETURN_ON_ERROR(gpio_set_level(s_gpio_num, 1), TAG, "gpio on failed");
    s_state = NURSERY_IRRIGATION_ON;
    s_end_time_us = esp_timer_get_time() + (int64_t)duration_sec * 1000000LL;
    if (s_timer) {
        esp_timer_stop(s_timer);
        ESP_RETURN_ON_ERROR(esp_timer_start_once(s_timer, duration_sec * 1000000ULL), TAG, "timer start failed");
    }
    ESP_LOGI(TAG, "irrigation on for %lu seconds", (unsigned long)duration_sec);
    return ESP_OK;
}

void nursery_irrigation_safe_off(const char *reason)
{
    if (s_gpio_num >= 0) {
        gpio_set_level(s_gpio_num, 0);
    }
    s_state = NURSERY_IRRIGATION_OFF;
    s_end_time_us = 0;
    ESP_LOGI(TAG, "irrigation safe-off: %s", reason ? reason : "unspecified");
}

nursery_irrigation_state_t nursery_irrigation_state(void)
{
    return s_state;
}

uint32_t nursery_irrigation_remaining_sec(void)
{
    if (s_state != NURSERY_IRRIGATION_ON || s_end_time_us <= 0) {
        return 0;
    }
    int64_t remaining_us = s_end_time_us - esp_timer_get_time();
    if (remaining_us <= 0) {
        return 0;
    }
    return (uint32_t)((remaining_us + 999999LL) / 1000000LL);
}
