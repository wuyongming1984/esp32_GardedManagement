#include "nursery_camera.h"

#include <errno.h>
#include <fcntl.h>
#include <inttypes.h>
#include <stdio.h>
#include <string.h>
#include <sys/ioctl.h>
#include <unistd.h>

#include "bsp/esp-bsp.h"
#include "driver/jpeg_encode.h"
#include "esp_check.h"
#include "esp_heap_caps.h"
#include "esp_http_server.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "esp_video_device.h"
#include "esp_video_init.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "linux/videodev2.h"

static const char *TAG = "nursery_camera";

#define NURSERY_VIDEO_FMT V4L2_PIX_FMT_RGB565
#define NURSERY_CAMERA_BUF_COUNT 3
#define NURSERY_MJPEG_BOUNDARY "nurseryframe"
#define NURSERY_JPEG_QUALITY 70
#define NURSERY_FRAME_INTERVAL_US 200000

static int s_video_fd = -1;
static uint8_t *s_camera_buffers[NURSERY_CAMERA_BUF_COUNT];
static uint8_t *s_encode_input_buffer;
static size_t s_camera_buffer_size;
static uint32_t s_camera_width;
static uint32_t s_camera_height;
static uint8_t s_camera_mem_mode;
static uint8_t *s_jpeg_buffer;
static size_t s_jpeg_capacity;
static uint32_t s_jpeg_size;
static uint32_t s_jpeg_seq;
static jpeg_encoder_handle_t s_jpeg_encoder;
static SemaphoreHandle_t s_jpeg_mutex;
static httpd_handle_t s_httpd;
static bool s_stream_task_started;
static nursery_camera_frame_cb_t s_frame_callback;
static void *s_frame_callback_ctx;

static esp_err_t camera_init_video_driver(void)
{
    ESP_RETURN_ON_ERROR(bsp_i2c_init(), TAG, "bsp_i2c_init failed");

    esp_video_init_csi_config_t csi_config[] = {
        {
            .sccb_config = {
                .init_sccb = false,
                .i2c_handle = bsp_i2c_get_handle(),
                .freq = CONFIG_BSP_I2C_CLK_SPEED_HZ,
            },
            .reset_pin = -1,
            .pwdn_pin = -1,
        },
    };
    esp_video_init_config_t camera_config = {
        .csi = csi_config,
    };

    return esp_video_init(&camera_config);
}

static esp_err_t camera_open_device(void)
{
    esp_err_t ret = ESP_OK;
    struct v4l2_capability capability = {0};
    struct v4l2_format format = {0};
    const int type = V4L2_BUF_TYPE_VIDEO_CAPTURE;

    s_video_fd = open(ESP_VIDEO_MIPI_CSI_DEVICE_NAME, O_RDONLY);
    ESP_RETURN_ON_FALSE(s_video_fd >= 0, ESP_FAIL, TAG, "open %s failed errno=%d", ESP_VIDEO_MIPI_CSI_DEVICE_NAME, errno);

    ESP_GOTO_ON_FALSE(ioctl(s_video_fd, VIDIOC_QUERYCAP, &capability) == 0, ESP_FAIL, fail, TAG, "VIDIOC_QUERYCAP failed");
    ESP_LOGI(TAG, "camera driver=%s card=%s bus=%s", capability.driver, capability.card, capability.bus_info);

    format.type = type;
    ESP_GOTO_ON_FALSE(ioctl(s_video_fd, VIDIOC_G_FMT, &format) == 0, ESP_FAIL, fail, TAG, "VIDIOC_G_FMT failed");
    ESP_LOGI(TAG, "camera default format width=%" PRIu32 " height=%" PRIu32 " pixelformat=0x%08" PRIx32,
             format.fmt.pix.width, format.fmt.pix.height, format.fmt.pix.pixelformat);

    if (format.fmt.pix.pixelformat != NURSERY_VIDEO_FMT) {
        format.fmt.pix.pixelformat = NURSERY_VIDEO_FMT;
        ESP_GOTO_ON_FALSE(ioctl(s_video_fd, VIDIOC_S_FMT, &format) == 0, ESP_FAIL, fail, TAG, "VIDIOC_S_FMT RGB565 failed");
    }

    memset(&format, 0, sizeof(format));
    format.type = type;
    ESP_GOTO_ON_FALSE(ioctl(s_video_fd, VIDIOC_G_FMT, &format) == 0, ESP_FAIL, fail, TAG, "VIDIOC_G_FMT after set failed");
    s_camera_width = format.fmt.pix.width;
    s_camera_height = format.fmt.pix.height;
    s_camera_buffer_size = s_camera_width * s_camera_height * 2;
    ESP_LOGI(TAG, "camera active format RGB565 %" PRIu32 "x%" PRIu32 " raw=%u bytes",
             s_camera_width, s_camera_height, (unsigned)s_camera_buffer_size);
    return ESP_OK;

fail:
    close(s_video_fd);
    s_video_fd = -1;
    return ret;
}

static esp_err_t camera_prepare_buffers(void)
{
    struct v4l2_requestbuffers req = {0};
    const int type = V4L2_BUF_TYPE_VIDEO_CAPTURE;

    req.count = NURSERY_CAMERA_BUF_COUNT;
    req.type = type;
    req.memory = V4L2_MEMORY_USERPTR;
    s_camera_mem_mode = req.memory;
    ESP_RETURN_ON_FALSE(ioctl(s_video_fd, VIDIOC_REQBUFS, &req) == 0, ESP_FAIL, TAG, "VIDIOC_REQBUFS failed");

    for (int i = 0; i < NURSERY_CAMERA_BUF_COUNT; i++) {
        s_camera_buffers[i] = heap_caps_aligned_calloc(128, 1, s_camera_buffer_size, MALLOC_CAP_SPIRAM);
        ESP_RETURN_ON_FALSE(s_camera_buffers[i] != NULL, ESP_ERR_NO_MEM, TAG, "camera buffer alloc failed");

        struct v4l2_buffer buffer = {0};
        buffer.type = type;
        buffer.memory = s_camera_mem_mode;
        buffer.index = i;
        ESP_RETURN_ON_FALSE(ioctl(s_video_fd, VIDIOC_QUERYBUF, &buffer) == 0, ESP_FAIL, TAG, "VIDIOC_QUERYBUF failed");
        buffer.m.userptr = (unsigned long)s_camera_buffers[i];
        buffer.length = s_camera_buffer_size;
        ESP_RETURN_ON_FALSE(ioctl(s_video_fd, VIDIOC_QBUF, &buffer) == 0, ESP_FAIL, TAG, "VIDIOC_QBUF failed");
    }

    s_encode_input_buffer = heap_caps_aligned_calloc(128, 1, s_camera_buffer_size, MALLOC_CAP_SPIRAM);
    ESP_RETURN_ON_FALSE(s_encode_input_buffer != NULL, ESP_ERR_NO_MEM, TAG, "jpeg input buffer alloc failed");

    jpeg_encode_memory_alloc_cfg_t jpeg_mem_cfg = {
        .buffer_direction = JPEG_ENC_ALLOC_OUTPUT_BUFFER,
    };
    s_jpeg_buffer = jpeg_alloc_encoder_mem(s_camera_buffer_size, &jpeg_mem_cfg, &s_jpeg_capacity);
    ESP_RETURN_ON_FALSE(s_jpeg_buffer != NULL, ESP_ERR_NO_MEM, TAG, "jpeg buffer alloc failed");

    jpeg_encode_engine_cfg_t encode_cfg = {
        .intr_priority = 0,
        .timeout_ms = 120,
    };
    ESP_RETURN_ON_ERROR(jpeg_new_encoder_engine(&encode_cfg, &s_jpeg_encoder), TAG, "jpeg encoder init failed");
    return ESP_OK;
}

static esp_err_t encode_latest_frame(const uint8_t *raw_buffer)
{
    jpeg_encode_cfg_t encode_cfg = {
        .height = s_camera_height,
        .width = s_camera_width,
        .src_type = JPEG_ENCODE_IN_FORMAT_RGB565,
        .sub_sample = JPEG_DOWN_SAMPLING_YUV422,
        .image_quality = NURSERY_JPEG_QUALITY,
    };
    uint32_t encoded_size = 0;
    esp_err_t err = jpeg_encoder_process(
        s_jpeg_encoder,
        &encode_cfg,
        raw_buffer,
        s_camera_buffer_size,
        s_jpeg_buffer,
        s_jpeg_capacity,
        &encoded_size);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "jpeg encode failed: %s", esp_err_to_name(err));
        return err;
    }

    xSemaphoreTake(s_jpeg_mutex, portMAX_DELAY);
    s_jpeg_size = encoded_size;
    s_jpeg_seq++;
    xSemaphoreGive(s_jpeg_mutex);
    return ESP_OK;
}

static void camera_stream_task(void *arg)
{
    (void)arg;
    int64_t next_encode_at = 0;
    const int type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
    ESP_LOGI(TAG, "Video Stream Start");
    if (ioctl(s_video_fd, VIDIOC_STREAMON, &type) != 0) {
        ESP_LOGE(TAG, "VIDIOC_STREAMON failed");
        vTaskDelete(NULL);
        return;
    }

    while (true) {
        struct v4l2_buffer buffer = {0};
        buffer.type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
        buffer.memory = s_camera_mem_mode;

        if (ioctl(s_video_fd, VIDIOC_DQBUF, &buffer) != 0) {
            ESP_LOGW(TAG, "VIDIOC_DQBUF failed");
            vTaskDelay(pdMS_TO_TICKS(20));
            continue;
        }

        bool should_encode = false;
        if (buffer.index < NURSERY_CAMERA_BUF_COUNT) {
            int64_t now = esp_timer_get_time();
            if (now >= next_encode_at) {
                memcpy(s_encode_input_buffer, s_camera_buffers[buffer.index], s_camera_buffer_size);
                next_encode_at = now + NURSERY_FRAME_INTERVAL_US;
                should_encode = true;
            }
        }

        buffer.m.userptr = (unsigned long)s_camera_buffers[buffer.index];
        buffer.length = s_camera_buffer_size;
        if (ioctl(s_video_fd, VIDIOC_QBUF, &buffer) != 0) {
            ESP_LOGW(TAG, "VIDIOC_QBUF release failed");
        }

        if (should_encode) {
            if (s_frame_callback) {
                s_frame_callback(s_encode_input_buffer, s_camera_width, s_camera_height, s_frame_callback_ctx);
            }
            encode_latest_frame(s_encode_input_buffer);
        }
    }
}

static esp_err_t mjpeg_stream_handler(httpd_req_t *req)
{
    httpd_resp_set_type(req, "multipart/x-mixed-replace;boundary=" NURSERY_MJPEG_BOUNDARY);
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
    httpd_resp_set_hdr(req, "Cache-Control", "no-store");

    char header[128];
    uint32_t last_seq = 0;
    while (true) {
        uint32_t seq = 0;
        uint32_t jpeg_size = 0;
        for (int retry = 0; retry < 100; retry++) {
            xSemaphoreTake(s_jpeg_mutex, portMAX_DELAY);
            seq = s_jpeg_seq;
            jpeg_size = s_jpeg_size;
            xSemaphoreGive(s_jpeg_mutex);
            if (jpeg_size > 0 && seq != last_seq) {
                break;
            }
            vTaskDelay(pdMS_TO_TICKS(40));
        }

        if (jpeg_size == 0 || seq == last_seq) {
            continue;
        }

        int header_len = snprintf(
            header,
            sizeof(header),
            "\r\n--" NURSERY_MJPEG_BOUNDARY "\r\nContent-Type: image/jpeg\r\nContent-Length: %" PRIu32 "\r\n\r\n",
            jpeg_size);

        xSemaphoreTake(s_jpeg_mutex, portMAX_DELAY);
        esp_err_t err = httpd_resp_send_chunk(req, header, header_len);
        if (err == ESP_OK) {
            err = httpd_resp_send_chunk(req, (const char *)s_jpeg_buffer, jpeg_size);
        }
        xSemaphoreGive(s_jpeg_mutex);

        if (err != ESP_OK) {
            ESP_LOGI(TAG, "mjpeg client disconnected");
            return err;
        }
        last_seq = seq;
    }
}

static esp_err_t start_mjpeg_server(void)
{
    httpd_config_t config = HTTPD_DEFAULT_CONFIG();
    config.server_port = 8080;
    config.ctrl_port = 32769;
    config.stack_size = 8192;
    config.lru_purge_enable = true;

    ESP_RETURN_ON_ERROR(httpd_start(&s_httpd, &config), TAG, "httpd_start failed");

    httpd_uri_t stream_uri = {
        .uri = "/stream.mjpg",
        .method = HTTP_GET,
        .handler = mjpeg_stream_handler,
        .user_ctx = NULL,
    };
    ESP_RETURN_ON_ERROR(httpd_register_uri_handler(s_httpd, &stream_uri), TAG, "register stream uri failed");
    ESP_LOGI(TAG, "MJPEG stream ready on http://<device-ip>:8080/stream.mjpg");
    return ESP_OK;
}

esp_err_t nursery_camera_init(void)
{
    s_jpeg_mutex = xSemaphoreCreateMutex();
    ESP_RETURN_ON_FALSE(s_jpeg_mutex != NULL, ESP_ERR_NO_MEM, TAG, "jpeg mutex alloc failed");

    ESP_RETURN_ON_ERROR(camera_init_video_driver(), TAG, "video driver init failed");
    ESP_RETURN_ON_ERROR(camera_open_device(), TAG, "camera open failed");
    ESP_RETURN_ON_ERROR(camera_prepare_buffers(), TAG, "camera buffer setup failed");
    ESP_LOGI(TAG, "OV5647 camera initialized");
    return ESP_OK;
}

esp_err_t nursery_camera_start_video_publish(const char *mode)
{
    ESP_LOGI(TAG, "video publish requested, mode=%s", mode ? mode : "mjpeg");
    if (!s_httpd) {
        ESP_RETURN_ON_ERROR(start_mjpeg_server(), TAG, "mjpeg server start failed");
    }
    if (!s_stream_task_started) {
        BaseType_t result = xTaskCreatePinnedToCore(
            camera_stream_task,
            "camera_mjpeg",
            8192,
            NULL,
            4,
            NULL,
            0);
        ESP_RETURN_ON_FALSE(result == pdPASS, ESP_FAIL, TAG, "camera stream task create failed");
        s_stream_task_started = true;
    }
    return ESP_OK;
}

void nursery_camera_set_frame_callback(nursery_camera_frame_cb_t callback, void *user_ctx)
{
    s_frame_callback = callback;
    s_frame_callback_ctx = user_ctx;
}

esp_err_t nursery_camera_copy_latest_jpeg(uint8_t *target, size_t target_capacity, size_t *out_size, uint32_t *out_seq)
{
    if (!target || !out_size || !out_seq) {
        return ESP_ERR_INVALID_ARG;
    }

    esp_err_t result = ESP_OK;
    xSemaphoreTake(s_jpeg_mutex, portMAX_DELAY);
    if (s_jpeg_size == 0) {
        result = ESP_ERR_NOT_FOUND;
    } else if (s_jpeg_size > target_capacity) {
        result = ESP_ERR_INVALID_SIZE;
    } else {
        memcpy(target, s_jpeg_buffer, s_jpeg_size);
        *out_size = s_jpeg_size;
        *out_seq = s_jpeg_seq;
    }
    xSemaphoreGive(s_jpeg_mutex);
    return result;
}
