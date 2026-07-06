# ESP32-P4 Nursery Device Firmware

Target board: `ESP32-P4-WIFI6-Touch-LCD-4.3` with OV5647 camera.

This is the v1 firmware skeleton for the nursery MVP:

- Wi-Fi station mode using ESP-IDF.
- Device credentials read from NVS keys `device_id` and `device_secret`.
- MQTT status/events publishing to `devices/{deviceId}/status` and `devices/{deviceId}/events`.
- Irrigation commands subscribed from `devices/{deviceId}/commands/irrigation/+`.
- GPIO defaults to safe-off on boot, disconnect, command timeout, and fault.
- Camera/video implementation boundary is isolated in `nursery_camera_*` so WebRTC/H.264 or MJPEG can be added after Waveshare bring-up.

Build boundary:

```powershell
cd firmware/nursery-device
idf.py set-target esp32p4
idf.py menuconfig
idf.py -p COM4 flash monitor
```

`idf.py` is not currently available in this Windows shell, so this project cannot be compiled here until ESP-IDF is installed/exported.
