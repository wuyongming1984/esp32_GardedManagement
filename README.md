# ESP32 Nursery Management MVP

End-to-end MVP scaffold for `ESP32-P4-WIFI6-Touch-LCD-4.3` nursery monitoring and limited-time irrigation.

## Workspaces

- `services/api`: NestJS API, domain logic, Prisma data model, MQTT/WebSocket integration points.
- `web/portal`: Next.js PC Web client for platform administrator and customer roles.
- `firmware/nursery-device`: ESP-IDF firmware skeleton for safe-off GPIO, MQTT command handling, and camera integration boundary.
- `deploy`: Docker Compose deployment with PostgreSQL, EMQX, coturn, Nginx, API, and portal.

## Server Deployment

See [deploy/README.md](deploy/README.md) for repeatable deployment steps on a new cloud server.

## Local Commands

```powershell
npm install --ignore-scripts --no-audit --no-fund
npm test
npm run build
```

Firmware build requires ESP-IDF in PATH:

```powershell
cd firmware/nursery-device
idf.py set-target esp32p4
idf.py -p COM4 flash monitor
```
