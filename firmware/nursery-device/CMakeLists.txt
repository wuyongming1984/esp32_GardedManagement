cmake_minimum_required(VERSION 3.16)

set(EXTRA_COMPONENT_DIRS
    "components/esp32_p4_wifi6_touch_lcd_4_3"
)

include($ENV{IDF_PATH}/tools/cmake/project.cmake)
project(nursery_device)
