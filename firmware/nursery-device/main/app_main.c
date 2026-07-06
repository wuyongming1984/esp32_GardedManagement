#include "esp_log.h"
#include "nvs_flash.h"
#include "nursery_camera.h"
#include "nursery_config.h"
#include "nursery_irrigation.h"
#include "nursery_mqtt.h"
#include "nursery_ui.h"
#include "nursery_wifi.h"

static const char *TAG = "nursery_device";

static void wifi_status_cb(bool connected, const char *ssid, const char *ip_text, void *user_ctx)
{
    (void)user_ctx;
    nursery_ui_set_wifi_status(connected, ssid, ip_text);
}

void app_main(void)
{
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ret = nvs_flash_init();
    }
    ESP_ERROR_CHECK(ret);

    nursery_config_t config;
    ESP_ERROR_CHECK(nursery_config_load(&config));
    ESP_ERROR_CHECK(nursery_irrigation_init(config.irrigation_gpio));
    ESP_ERROR_CHECK(nursery_ui_init(&config));

    ESP_ERROR_CHECK(nursery_camera_init());
    nursery_camera_set_frame_callback(nursery_ui_camera_frame, NULL);
    nursery_ui_set_camera_status("摄像头已初始化，正在等待画面...");

    ESP_ERROR_CHECK(nursery_wifi_start(&config, wifi_status_cb, NULL));
    nursery_ui_request_wifi_scan();

    ESP_ERROR_CHECK(nursery_mqtt_start(&config));
    nursery_ui_set_mqtt_status(false);
    ESP_ERROR_CHECK(nursery_camera_start_video_publish("mjpeg"));
    ESP_LOGI(TAG, "nursery device started: %s", config.device_id);
}
