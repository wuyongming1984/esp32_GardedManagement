#pragma once

#include "esp_err.h"
#include "nursery_config.h"

esp_err_t nursery_mqtt_start(const nursery_config_t *config);
void nursery_mqtt_publish_status(void);
