# Nursery MVP Implementation Notes

## Delivered Structure

- `firmware/nursery-device`: ESP-IDF project skeleton for ESP32-P4 device bring-up, MQTT command handling, and safe-off irrigation GPIO control.
- `services/api`: NestJS API scaffold with tested domain services, Prisma schema, REST controllers, MQTT bridge, and WebSocket gateway.
- `web/portal`: Next.js Web portal with administrator/customer dashboard states.
- `deploy`: Docker Compose stack for PostgreSQL, EMQX, coturn, API, portal, and Nginx.

## Local Limits

- `idf.py` is not available in this shell, so firmware compile/flash was not run locally.
- The current `.git` entry is not recognized by `git`, so no commit or branch isolation was created.

## First Hardware Bring-Up

1. Install and export ESP-IDF for ESP32-P4.
2. Provision NVS keys on the device:
   - `device_id`
   - `device_secret`
   - `mqtt_uri`
   - `wifi_ssid`
   - `wifi_pass`
   - `water_gpio`
3. Build and flash:

```powershell
cd firmware/nursery-device
idf.py set-target esp32p4
idf.py -p COM4 flash monitor
```

4. Confirm GPIO is low at boot and after network disconnect.
5. Replace `nursery_camera.c` placeholders with Waveshare OV5647 capture and WebRTC/H.264 or MJPEG publish implementation.
