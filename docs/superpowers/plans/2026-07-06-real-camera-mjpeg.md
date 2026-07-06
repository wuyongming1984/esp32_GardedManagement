# Real Camera MJPEG Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the actual OV5647 camera image from the ESP32-P4 board in the PC portal.

**Architecture:** The ESP32-P4 firmware will initialize the Waveshare OV5647 MIPI-CSI camera through `esp_video`, encode captured RGB frames to JPEG, and expose them as an HTTP multipart MJPEG stream on port `8080`. The API will report the board's local MJPEG URL for `device-north-01`, and the portal will render that stream in the preview panel.

**Tech Stack:** ESP-IDF 5.5.2, `esp_video`, ESP HTTP Server, ESP JPEG encoder, NestJS, Next.js.

---

### Task 1: Firmware Camera Stream

**Files:**
- Modify: `firmware/nursery-device/main/idf_component.yml`
- Modify: `firmware/nursery-device/sdkconfig.defaults`
- Modify: `firmware/nursery-device/main/CMakeLists.txt`
- Modify: `firmware/nursery-device/main/nursery_camera.h`
- Modify: `firmware/nursery-device/main/nursery_camera.c`

- [ ] Add `esp_video`, `waveshare/esp32_p4_wifi6_touch_lcd_4_3`, and HTTP server dependencies.
- [ ] Add OV5647 MIPI-CSI sdkconfig defaults matching Waveshare `09_video_lcd_display`.
- [ ] Initialize BSP I2C, `esp_video`, and `/dev/video*` capture in `nursery_camera_init`.
- [ ] Encode latest captured frame to JPEG.
- [ ] Start HTTP MJPEG endpoint at `/stream.mjpg`.
- [ ] Build with `idf.py build`.

### Task 2: Portal Stream Rendering

**Files:**
- Modify: `services/api/src/domain/types.ts`
- Modify: `services/api/src/domain/seed.ts`
- Modify: `services/api/src/domain/video-session.service.ts`
- Modify: `web/portal/src/lib/types.ts`
- Modify: `web/portal/src/lib/dashboard-shell.tsx`
- Modify: `web/portal/test/dashboard.test.tsx`

- [ ] Add `mjpegStreamUrl` to device/video session data.
- [ ] Return `http://192.168.110.184:8080/stream.mjpg` for `device-north-01`.
- [ ] Render `<img>` for MJPEG preview when a stream URL is present.
- [ ] Keep the placeholder only when no stream URL exists.
- [ ] Run portal lint and tests.

### Task 3: Flash And Verify

**Files:**
- No source files beyond Tasks 1-2.

- [ ] Rebuild firmware.
- [ ] Flash app to COM4 with existing NVS settings.
- [ ] Monitor serial logs for camera init and HTTP stream startup.
- [ ] Open `http://127.0.0.1:3003`, click preview, and verify a real MJPEG `<img>` is rendered.
- [ ] Check `http://192.168.110.184:8080/stream.mjpg` responds with multipart MJPEG.
