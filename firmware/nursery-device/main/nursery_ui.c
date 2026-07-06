#include "nursery_ui.h"

#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include "bsp/esp-bsp.h"
#include "esp_check.h"
#include "esp_heap_caps.h"
#include "esp_lcd_touch.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "lvgl.h"
#include "nursery_irrigation.h"
#include "nursery_wifi.h"

static const char *TAG = "nursery_ui";

#define PREVIEW_W 240
#define PREVIEW_H 360

LV_FONT_DECLARE(nursery_ui_font_18);

static lv_obj_t *s_wifi_status_label;
static lv_obj_t *s_mqtt_status_label;
static lv_obj_t *s_wifi_dropdown;
static lv_obj_t *s_wifi_password_ta;
static lv_obj_t *s_keyboard;
static lv_obj_t *s_camera_status_label;
static lv_obj_t *s_camera_image;
static lv_obj_t *s_irrigation_status_label;
static lv_obj_t *s_irrigation_duration_ta;

static uint8_t *s_preview_buffer;
static lv_image_dsc_t s_preview_dsc;
static bool s_ui_ready;
static nursery_wifi_ap_t s_scan_aps[NURSERY_WIFI_MAX_APS];
static uint16_t s_scan_count;
static char s_wifi_options[768];
static char s_connect_ssid[33];
static char s_connect_password[64];

typedef struct {
    esp_lcd_touch_handle_t handle;
    lv_indev_t *indev;
    struct {
        float x;
        float y;
    } scale;
    bool with_irq;
    SemaphoreHandle_t touch_sem;
    void *isr_ctx;
    lv_point_t last_point;
    lv_indev_state_t last_state;
} touch_adapter_diag_ctx_t;

static lv_indev_t *s_touch_indev;

static void set_ui_font(lv_obj_t *obj)
{
    if (obj) {
        lv_obj_set_style_text_font(obj, &nursery_ui_font_18, 0);
    }
}

static void make_ssid_display_name(const char *ssid, uint16_t index, char *target, size_t target_len)
{
    bool ascii_only = true;
    for (const unsigned char *p = (const unsigned char *)ssid; p && *p; p++) {
        if (*p < 0x20 || *p > 0x7e) {
            ascii_only = false;
            break;
        }
    }

    if (ascii_only && ssid && ssid[0] != '\0') {
        snprintf(target, target_len, "%.32s", ssid);
    } else {
        snprintf(target, target_len, "WiFi%u", (unsigned)(index + 1));
    }
}

static void set_label_text(lv_obj_t *label, const char *text)
{
    if (label) {
        lv_label_set_text(label, text ? text : "");
    }
}

static void log_touch_event(lv_event_t *event)
{
    lv_event_code_t code = lv_event_get_code(event);
    if (code == LV_EVENT_PRESSED || code == LV_EVENT_RELEASED || code == LV_EVENT_CLICKED || code == LV_EVENT_SHORT_CLICKED) {
        ESP_LOGI(TAG, "ui touch target=%p code=%s", lv_event_get_target_obj(event), lv_event_code_get_name(code));
    }
}

static void touch_diag_timer_cb(lv_timer_t *timer)
{
    (void)timer;
    static bool logged_device;
    static uint32_t idle_ticks;

    if (s_touch_indev == NULL) {
        s_touch_indev = bsp_display_get_input_dev();
    }
    if (s_touch_indev == NULL) {
        if (!logged_device) {
            ESP_LOGW(TAG, "touch diag: no LVGL input device");
            logged_device = true;
        }
        return;
    }

    touch_adapter_diag_ctx_t *ctx = (touch_adapter_diag_ctx_t *)lv_indev_get_driver_data(s_touch_indev);
    if (ctx == NULL || ctx->handle == NULL) {
        if (!logged_device) {
            ESP_LOGW(TAG, "touch diag: no touch handle");
            logged_device = true;
        }
        return;
    }

    if (!logged_device) {
        ESP_LOGI(TAG, "touch diag: input=%p irq=%d", s_touch_indev, ctx->with_irq ? 1 : 0);
        logged_device = true;
    }

    esp_lcd_touch_point_data_t points[1] = {0};
    uint8_t count = 0;
    esp_err_t err = esp_lcd_touch_read_data(ctx->handle);
    if (err == ESP_OK) {
        err = esp_lcd_touch_get_data(ctx->handle, points, &count, 1);
    }

    if (err != ESP_OK) {
        ESP_LOGW(TAG, "touch diag: read failed %s", esp_err_to_name(err));
        return;
    }
    if (count > 0) {
        lv_point_t lv_point = {0};
        lv_indev_get_point(s_touch_indev, &lv_point);
        ESP_LOGI(TAG, "raw touch x=%u y=%u strength=%u lv=(%d,%d) state=%d",
                 points[0].x,
                 points[0].y,
                 points[0].strength,
                 (int)lv_point.x,
                 (int)lv_point.y,
                 (int)lv_indev_get_state(s_touch_indev));
        idle_ticks = 0;
    } else if (++idle_ticks >= 10) {
        ESP_LOGI(TAG, "touch diag: waiting for finger");
        idle_ticks = 0;
    }
}

static lv_obj_t *make_label(lv_obj_t *parent, const char *text)
{
    lv_obj_t *label = lv_label_create(parent);
    set_ui_font(label);
    lv_label_set_text(label, text);
    lv_obj_set_width(label, lv_pct(100));
    return label;
}

static lv_obj_t *make_button(lv_obj_t *parent, const char *text, lv_event_cb_t cb, void *user_data)
{
    lv_obj_t *button = lv_button_create(parent);
    lv_obj_set_size(button, 130, 46);
    lv_obj_add_event_cb(button, log_touch_event, LV_EVENT_ALL, NULL);
    lv_obj_add_event_cb(button, cb, LV_EVENT_CLICKED, user_data);
    lv_obj_t *label = lv_label_create(button);
    set_ui_font(label);
    lv_label_set_text(label, text);
    lv_obj_center(label);
    return button;
}

static void textarea_event_cb(lv_event_t *event)
{
    lv_event_code_t code = lv_event_get_code(event);
    lv_obj_t *target = lv_event_get_target_obj(event);
    if (code == LV_EVENT_CLICKED || code == LV_EVENT_FOCUSED) {
        if (s_keyboard) {
            lv_keyboard_set_textarea(s_keyboard, target);
            lv_obj_remove_flag(s_keyboard, LV_OBJ_FLAG_HIDDEN);
        }
    } else if (code == LV_EVENT_READY || code == LV_EVENT_CANCEL || code == LV_EVENT_DEFOCUSED) {
        if (s_keyboard) {
            lv_obj_add_flag(s_keyboard, LV_OBJ_FLAG_HIDDEN);
        }
    }
}

static void scan_task(void *arg)
{
    (void)arg;
    nursery_wifi_ap_t aps[NURSERY_WIFI_MAX_APS] = {0};
    uint16_t count = NURSERY_WIFI_MAX_APS;
    esp_err_t err = nursery_wifi_scan(aps, &count);
    ESP_LOGI(TAG, "screen wifi scan result err=%s count=%u", esp_err_to_name(err), count);

    if (bsp_display_lock(1000) == ESP_OK) {
        if (err != ESP_OK) {
            char text[96];
            snprintf(text, sizeof(text), "Wi-Fi 扫描失败：%s", esp_err_to_name(err));
            set_label_text(s_wifi_status_label, text);
        } else {
            memcpy(s_scan_aps, aps, sizeof(s_scan_aps));
            s_scan_count = count;
            s_wifi_options[0] = '\0';
            for (uint16_t i = 0; i < count; i++) {
                char line[96];
                char ssid_name[40];
                make_ssid_display_name(aps[i].ssid, i, ssid_name, sizeof(ssid_name));
                snprintf(line, sizeof(line), "%s  %ddBm%s", ssid_name, aps[i].rssi, aps[i].auth_required ? "  加密" : "  开放");
                strlcat(s_wifi_options, line, sizeof(s_wifi_options));
                if (i + 1 < count) {
                    strlcat(s_wifi_options, "\n", sizeof(s_wifi_options));
                }
            }
            if (count == 0) {
                strlcpy(s_wifi_options, "未发现 Wi-Fi", sizeof(s_wifi_options));
            }
            lv_dropdown_set_options(s_wifi_dropdown, s_wifi_options);
            if (count == 0) {
                set_label_text(s_wifi_status_label, "未发现 Wi-Fi");
            } else {
                char text[80];
                snprintf(text, sizeof(text), "发现 %u 个 Wi-Fi，已展开列表", count);
                set_label_text(s_wifi_status_label, text);
                lv_dropdown_set_selected(s_wifi_dropdown, 0);
                lv_dropdown_open(s_wifi_dropdown);
                set_ui_font(lv_dropdown_get_list(s_wifi_dropdown));
            }
        }
        bsp_display_unlock();
    }
    vTaskDelete(NULL);
}

static void scan_button_cb(lv_event_t *event)
{
    (void)event;
    ESP_LOGI(TAG, "scan button clicked");
    set_label_text(s_wifi_status_label, "正在扫描 Wi-Fi...");
    nursery_ui_request_wifi_scan();
}

static void connect_task(void *arg)
{
    (void)arg;
    esp_err_t err = nursery_wifi_connect_and_save(s_connect_ssid, s_connect_password);
    if (bsp_display_lock(1000) == ESP_OK) {
        set_label_text(s_wifi_status_label, err == ESP_OK ? "Wi-Fi 已连接并保存" : "Wi-Fi 连接失败，请检查密码或信号");
        bsp_display_unlock();
    }
    vTaskDelete(NULL);
}

static void connect_button_cb(lv_event_t *event)
{
    (void)event;
    if (s_scan_count == 0) {
        set_label_text(s_wifi_status_label, "请先扫描 Wi-Fi");
        return;
    }
    uint16_t selected = lv_dropdown_get_selected(s_wifi_dropdown);
    if (selected >= s_scan_count) {
        set_label_text(s_wifi_status_label, "请选择有效 Wi-Fi");
        return;
    }
    strlcpy(s_connect_ssid, s_scan_aps[selected].ssid, sizeof(s_connect_ssid));
    strlcpy(s_connect_password, lv_textarea_get_text(s_wifi_password_ta), sizeof(s_connect_password));
    set_label_text(s_wifi_status_label, "正在连接 Wi-Fi...");
    xTaskCreate(connect_task, "ui_wifi_connect", 4096, NULL, 4, NULL);
}

static void irrigation_start_cb(lv_event_t *event)
{
    uint32_t duration = (uint32_t)(uintptr_t)lv_event_get_user_data(event);
    if (duration == 0 && s_irrigation_duration_ta) {
        duration = (uint32_t)atoi(lv_textarea_get_text(s_irrigation_duration_ta));
    }
    if (nursery_irrigation_start_limited(duration) != ESP_OK) {
        set_label_text(s_irrigation_status_label, "时长无效，请输入 1-900 秒");
        return;
    }
    set_label_text(s_irrigation_status_label, "浇灌运行中");
}

static void irrigation_stop_cb(lv_event_t *event)
{
    (void)event;
    nursery_irrigation_safe_off("local screen stop");
    set_label_text(s_irrigation_status_label, "浇灌已关闭");
}

static void irrigation_timer_cb(lv_timer_t *timer)
{
    (void)timer;
    char text[64];
    if (nursery_irrigation_state() == NURSERY_IRRIGATION_ON) {
        snprintf(text, sizeof(text), "浇灌运行中，剩余 %lu 秒", (unsigned long)nursery_irrigation_remaining_sec());
    } else {
        strlcpy(text, "浇灌已关闭", sizeof(text));
    }
    set_label_text(s_irrigation_status_label, text);
}

static void build_network_tab(lv_obj_t *tab, const nursery_config_t *config)
{
    lv_obj_set_flex_flow(tab, LV_FLEX_FLOW_COLUMN);
    lv_obj_set_style_pad_all(tab, 12, 0);
    lv_obj_set_style_pad_gap(tab, 10, 0);
    lv_obj_add_flag(tab, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_add_event_cb(tab, log_touch_event, LV_EVENT_ALL, NULL);

    s_wifi_status_label = make_label(tab, "Wi-Fi 未连接");
    s_mqtt_status_label = make_label(tab, "MQTT：未连接");
    if (config && strlen(config->wifi_ssid) > 0) {
        char text[128];
        char ssid_name[40];
        make_ssid_display_name(config->wifi_ssid, 0, ssid_name, sizeof(ssid_name));
        snprintf(text, sizeof(text), "已保存 Wi-Fi：%s，正在连接...", ssid_name);
        set_label_text(s_wifi_status_label, text);
    }

    lv_obj_t *scan_button = make_button(tab, "扫描 Wi-Fi", scan_button_cb, NULL);
    lv_obj_set_size(scan_button, lv_pct(92), 60);
    s_wifi_dropdown = lv_dropdown_create(tab);
    set_ui_font(s_wifi_dropdown);
    lv_obj_set_width(s_wifi_dropdown, lv_pct(92));
    lv_dropdown_set_options(s_wifi_dropdown, "请先扫描 Wi-Fi");

    s_wifi_password_ta = lv_textarea_create(tab);
    set_ui_font(s_wifi_password_ta);
    lv_obj_set_width(s_wifi_password_ta, lv_pct(92));
    lv_textarea_set_one_line(s_wifi_password_ta, true);
    lv_textarea_set_password_mode(s_wifi_password_ta, true);
    lv_textarea_set_placeholder_text(s_wifi_password_ta, "请输入 Wi-Fi 密码");
    lv_obj_add_event_cb(s_wifi_password_ta, textarea_event_cb, LV_EVENT_ALL, NULL);
    make_button(tab, "连接", connect_button_cb, NULL);
}

static void build_camera_tab(lv_obj_t *tab)
{
    lv_obj_set_flex_flow(tab, LV_FLEX_FLOW_ROW);
    lv_obj_set_style_pad_all(tab, 10, 0);
    lv_obj_set_style_pad_gap(tab, 12, 0);

    s_camera_image = lv_image_create(tab);
    lv_obj_set_size(s_camera_image, PREVIEW_W, PREVIEW_H);
    lv_obj_set_style_bg_color(s_camera_image, lv_color_hex(0x101820), 0);
    lv_obj_set_style_bg_opa(s_camera_image, LV_OPA_COVER, 0);

    lv_obj_t *side = lv_obj_create(tab);
    lv_obj_set_size(side, 500, LV_SIZE_CONTENT);
    lv_obj_set_flex_flow(side, LV_FLEX_FLOW_COLUMN);
    lv_obj_set_style_pad_all(side, 10, 0);
    lv_obj_set_style_pad_gap(side, 10, 0);
    s_camera_status_label = make_label(side, "摄像头正在启动...");
    make_label(side, "画面来自 OV5647 实际采集帧");
    make_label(side, "PC 后台 MJPEG 预览继续可用");
}

static void build_irrigation_tab(lv_obj_t *tab)
{
    lv_obj_set_flex_flow(tab, LV_FLEX_FLOW_COLUMN);
    lv_obj_set_style_pad_all(tab, 12, 0);
    lv_obj_set_style_pad_gap(tab, 12, 0);

    s_irrigation_status_label = make_label(tab, "浇灌已关闭");

    lv_obj_t *row = lv_obj_create(tab);
    lv_obj_set_size(row, lv_pct(96), 70);
    lv_obj_set_flex_flow(row, LV_FLEX_FLOW_ROW);
    lv_obj_set_style_pad_all(row, 8, 0);
    lv_obj_set_style_pad_gap(row, 10, 0);
    make_button(row, "10秒", irrigation_start_cb, (void *)(uintptr_t)10);
    make_button(row, "30秒", irrigation_start_cb, (void *)(uintptr_t)30);
    make_button(row, "60秒", irrigation_start_cb, (void *)(uintptr_t)60);

    s_irrigation_duration_ta = lv_textarea_create(tab);
    set_ui_font(s_irrigation_duration_ta);
    lv_obj_set_width(s_irrigation_duration_ta, 220);
    lv_textarea_set_one_line(s_irrigation_duration_ta, true);
    lv_textarea_set_accepted_chars(s_irrigation_duration_ta, "0123456789");
    lv_textarea_set_max_length(s_irrigation_duration_ta, 3);
    lv_textarea_set_placeholder_text(s_irrigation_duration_ta, "自定义秒数 1-900");
    lv_obj_add_event_cb(s_irrigation_duration_ta, textarea_event_cb, LV_EVENT_ALL, NULL);
    make_button(tab, "开始自定义", irrigation_start_cb, NULL);
    make_button(tab, "立即关闭", irrigation_stop_cb, NULL);
    lv_timer_create(irrigation_timer_cb, 1000, NULL);
}

esp_err_t nursery_ui_init(const nursery_config_t *config)
{
    bsp_display_cfg_t cfg = {
        .lv_adapter_cfg = ESP_LV_ADAPTER_DEFAULT_CONFIG(),
        .rotation = ESP_LV_ADAPTER_ROTATE_0,
        .tear_avoid_mode = ESP_LV_ADAPTER_TEAR_AVOID_MODE_TRIPLE_PARTIAL,
        .touch_flags = {
            .swap_xy = 0,
            .mirror_x = 0,
            .mirror_y = 0,
        },
    };
    lv_display_t *display = bsp_display_start_with_config(&cfg);
    ESP_RETURN_ON_FALSE(display != NULL, ESP_FAIL, TAG, "display start failed");
    bsp_display_backlight_on();

    s_preview_buffer = heap_caps_malloc(PREVIEW_W * PREVIEW_H * 2, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    ESP_RETURN_ON_FALSE(s_preview_buffer != NULL, ESP_ERR_NO_MEM, TAG, "preview buffer alloc failed");
    memset(s_preview_buffer, 0, PREVIEW_W * PREVIEW_H * 2);
    s_preview_dsc.header.magic = LV_IMAGE_HEADER_MAGIC;
    s_preview_dsc.header.cf = LV_COLOR_FORMAT_RGB565;
    s_preview_dsc.header.w = PREVIEW_W;
    s_preview_dsc.header.h = PREVIEW_H;
    s_preview_dsc.header.stride = PREVIEW_W * 2;
    s_preview_dsc.data_size = PREVIEW_W * PREVIEW_H * 2;
    s_preview_dsc.data = s_preview_buffer;

    ESP_RETURN_ON_ERROR(bsp_display_lock(0), TAG, "display lock failed");
    lv_obj_t *tabview = lv_tabview_create(lv_screen_active());
    lv_obj_set_size(tabview, lv_pct(100), lv_pct(100));
    set_ui_font(lv_tabview_get_tab_bar(tabview));
    lv_obj_t *network_tab = lv_tabview_add_tab(tabview, "网络");
    lv_obj_t *camera_tab = lv_tabview_add_tab(tabview, "摄像头");
    lv_obj_t *irrigation_tab = lv_tabview_add_tab(tabview, "浇灌");
    build_network_tab(network_tab, config);
    build_camera_tab(camera_tab);
    build_irrigation_tab(irrigation_tab);

    s_keyboard = lv_keyboard_create(lv_screen_active());
    lv_obj_set_size(s_keyboard, LV_HOR_RES, LV_VER_RES / 2);
    lv_obj_align(s_keyboard, LV_ALIGN_BOTTOM_MID, 0, 0);
    lv_obj_add_flag(s_keyboard, LV_OBJ_FLAG_HIDDEN);
    s_touch_indev = bsp_display_get_input_dev();
    ESP_LOGI(TAG, "touch input device=%p", s_touch_indev);
    lv_timer_create(touch_diag_timer_cb, 500, NULL);
    bsp_display_unlock();

    s_ui_ready = true;
    ESP_LOGI(TAG, "screen UI initialized");
    return ESP_OK;
}

void nursery_ui_request_wifi_scan(void)
{
    if (!s_ui_ready) {
        return;
    }
    if (bsp_display_lock(100) == ESP_OK) {
        set_label_text(s_wifi_status_label, "正在扫描 Wi-Fi...");
        bsp_display_unlock();
    }
    xTaskCreate(scan_task, "ui_wifi_scan", 8192, NULL, 4, NULL);
}

void nursery_ui_set_wifi_status(bool connected, const char *ssid, const char *ip_text)
{
    if (!s_ui_ready || bsp_display_lock(50) != ESP_OK) {
        return;
    }
    char text[128];
    char ssid_name[40];
    make_ssid_display_name(ssid, 0, ssid_name, sizeof(ssid_name));
    snprintf(text, sizeof(text), "Wi-Fi：%s  SSID：%s  IP：%.15s",
             connected ? "已连接" : "未连接",
             ssid && strlen(ssid) > 0 ? ssid_name : "未选择",
             ip_text ? ip_text : "0.0.0.0");
    set_label_text(s_wifi_status_label, text);
    bsp_display_unlock();
}

void nursery_ui_set_mqtt_status(bool connected)
{
    if (!s_ui_ready || bsp_display_lock(50) != ESP_OK) {
        return;
    }
    set_label_text(s_mqtt_status_label, connected ? "MQTT：已连接" : "MQTT：未连接");
    bsp_display_unlock();
}

void nursery_ui_set_camera_status(const char *text)
{
    if (!s_ui_ready || bsp_display_lock(50) != ESP_OK) {
        return;
    }
    set_label_text(s_camera_status_label, text);
    bsp_display_unlock();
}

void nursery_ui_camera_frame(const uint8_t *rgb565, uint32_t width, uint32_t height, void *user_ctx)
{
    (void)user_ctx;
    if (!s_ui_ready || !s_preview_buffer || !rgb565 || width == 0 || height == 0) {
        return;
    }
    if (bsp_display_lock(0) != ESP_OK) {
        return;
    }

    const uint16_t *src = (const uint16_t *)rgb565;
    uint16_t *dst = (uint16_t *)s_preview_buffer;
    for (uint32_t y = 0; y < PREVIEW_H; y++) {
        uint32_t src_y = (y * height) / PREVIEW_H;
        for (uint32_t x = 0; x < PREVIEW_W; x++) {
            uint32_t src_x = (x * width) / PREVIEW_W;
            dst[y * PREVIEW_W + x] = src[src_y * width + src_x];
        }
    }
    lv_image_set_src(s_camera_image, &s_preview_dsc);
    lv_obj_invalidate(s_camera_image);
    set_label_text(s_camera_status_label, "摄像头画面实时更新中");
    bsp_display_unlock();
}
