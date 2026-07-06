import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import mqtt from "mqtt";
import { appState } from "../app-state.js";
import { NurseryStore } from "../domain/types.js";

interface DeviceStatusPayload {
  irrigationState?: "on" | "off";
  mjpegUrl?: string;
}

@Injectable()
export class MqttBridgeService implements OnModuleInit {
  private readonly logger = new Logger(MqttBridgeService.name);

  onModuleInit() {
    const url = process.env.MQTT_URL;
    if (!url) {
      this.logger.warn("MQTT_URL not configured; broker bridge disabled for local tests");
      return;
    }

    const client = mqtt.connect(url, {
      username: process.env.MQTT_USERNAME,
      password: process.env.MQTT_PASSWORD
    });

    client.on("connect", () => {
      this.logger.log("MQTT connected");
      client.subscribe("devices/+/status");
      client.subscribe("devices/+/events");
      client.subscribe("devices/+/video/mjpeg");
    });

    client.on("message", (topic, payload) => {
      const [, deviceId, channel, subchannel] = topic.split("/");
      const device = appState.store.devices.get(deviceId);
      if (!device) {
        return;
      }
      if (channel === "video" && subchannel === "mjpeg") {
        storeDeviceMjpegFrame(appState.store, deviceId, payload);
        return;
      }
      if (channel === "status") {
        const status = parseDeviceStatusPayload(payload);
        device.status = "online";
        device.lastSeenAt = new Date();
        if (status?.irrigationState) {
          device.irrigationState = status.irrigationState;
        }
        if (status?.mjpegUrl && isAllowedMjpegUrl(status.mjpegUrl)) {
          device.mjpegStreamUrl = status.mjpegUrl;
        }
      }
      if (channel === "events") {
        this.logger.log(`Device event ${deviceId}: ${payload.toString()}`);
      }
    });
  }
}

export function storeDeviceMjpegFrame(
  store: NurseryStore,
  deviceId: string,
  payload: Buffer,
  now: Date = new Date()
): boolean {
  const device = store.devices.get(deviceId);
  if (!device || payload.length < 4) {
    return false;
  }
  store.latestMjpegFrames.set(deviceId, {
    data: Buffer.from(payload),
    contentType: "image/jpeg",
    updatedAt: now
  });
  device.status = "online";
  device.lastSeenAt = now;
  device.mjpegStreamUrl = `/api/devices/${deviceId}/mjpeg/latest.jpg`;
  return true;
}

export function parseDeviceStatusPayload(payload: Buffer): DeviceStatusPayload | undefined {
  try {
    return JSON.parse(payload.toString()) as DeviceStatusPayload;
  } catch {
    return undefined;
  }
}

export function isAllowedMjpegUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" && url.pathname === "/stream.mjpg";
  } catch {
    return false;
  }
}
