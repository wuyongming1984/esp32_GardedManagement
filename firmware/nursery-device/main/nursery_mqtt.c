#include "nursery_mqtt.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "esp_log.h"
#include "mqtt_client.h"
#include "nursery_irrigation.h"
#include "nursery_ui.h"

static const char *TAG = "nursery_mqtt";
static esp_mqtt_client_handle_t s_client;
static nursery_config_t s_config;

static void publish_event(const char *event, const char *detail)
{
    if (!s_client) {
        return;
    }
    char topic[128];
    char payload[256];
    snprintf(topic, sizeof(topic), "devices/%s/events", s_config.device_id);
    snprintf(payload, sizeof(payload), "{\"event\":\"%s\",\"detail\":\"%s\"}", event, detail ? detail : "");
    esp_mqtt_client_publish(s_client, topic, payload, 0, 1, 0);
}

void nursery_mqtt_publish_status(void)
{
    if (!s_client) {
        return;
    }
    char topic[128];
    char payload[192];
    snprintf(topic, sizeof(topic), "devices/%s/status", s_config.device_id);
    snprintf(
        payload,
        sizeof(payload),
        "{\"status\":\"online\",\"irrigationState\":\"%s\"}",
        nursery_irrigation_state() == NURSERY_IRRIGATION_ON ? "on" : "off"
    );
    esp_mqtt_client_publish(s_client, topic, payload, 0, 1, 1);
}

static uint32_t parse_duration_sec(const char *payload)
{
    const char *key = strstr(payload, "durationSec");
    if (!key) {
        return 0;
    }
    const char *colon = strchr(key, ':');
    if (!colon) {
        return 0;
    }
    return (uint32_t)atoi(colon + 1);
}

static void mqtt_event_handler(void *args, esp_event_base_t base, int32_t event_id, void *event_data)
{
    (void)args;
    (void)base;
    esp_mqtt_event_handle_t event = event_data;

    if (event_id == MQTT_EVENT_CONNECTED) {
        char command_topic[160];
        snprintf(command_topic, sizeof(command_topic), "devices/%s/commands/irrigation/+", s_config.device_id);
        esp_mqtt_client_subscribe(s_client, command_topic, 1);
        nursery_ui_set_mqtt_status(true);
        nursery_mqtt_publish_status();
        publish_event("device.connected", "mqtt connected");
        return;
    }

    if (event_id == MQTT_EVENT_DISCONNECTED) {
        nursery_ui_set_mqtt_status(false);
        nursery_irrigation_safe_off("mqtt disconnected");
        return;
    }

    if (event_id == MQTT_EVENT_DATA) {
        char payload[192] = {0};
        size_t copy_len = event->data_len < sizeof(payload) - 1 ? event->data_len : sizeof(payload) - 1;
        memcpy(payload, event->data, copy_len);
        uint32_t duration_sec = parse_duration_sec(payload);
        if (nursery_irrigation_start_limited(duration_sec) == ESP_OK) {
            publish_event("irrigation.running", payload);
        } else {
            nursery_irrigation_safe_off("invalid irrigation command");
            publish_event("irrigation.rejected", payload);
        }
        nursery_mqtt_publish_status();
    }
}

esp_err_t nursery_mqtt_start(const nursery_config_t *config)
{
    s_config = *config;
    esp_mqtt_client_config_t mqtt_cfg = {
        .broker.address.uri = s_config.mqtt_uri,
        .credentials.username = s_config.device_id,
        .credentials.authentication.password = s_config.device_secret,
    };
    s_client = esp_mqtt_client_init(&mqtt_cfg);
    esp_mqtt_client_register_event(s_client, ESP_EVENT_ANY_ID, mqtt_event_handler, NULL);
    return esp_mqtt_client_start(s_client);
}
