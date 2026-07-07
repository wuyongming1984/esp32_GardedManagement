import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import mqtt from "mqtt";
import { appState } from "../app-state.js";
import { IrrigationCommand, NurseryStore } from "../domain/types.js";

interface DeviceStatusPayload {
  irrigationState?: "on" | "off";
  irrigationRemainingSec?: number;
  mjpegUrl?: string;
}

let mqttClient: mqtt.MqttClient | undefined;

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
    mqttClient = client;

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
        applyDeviceStatusPayload(appState.store, deviceId, payload);
      }
      if (channel === "events") {
        this.logger.log(`Device event ${deviceId}: ${payload.toString()}`);
      }
    });
  }
}

export function buildIrrigationCommandPayload(command: Pick<IrrigationCommand, "id" | "durationSec">): string {
  return JSON.stringify({
    commandId: command.id,
    durationSec: command.durationSec,
    source: "pc"
  });
}

export function publishIrrigationCommand(command: IrrigationCommand): boolean {
  if (!mqttClient?.connected) {
    return false;
  }
  mqttClient.publish(command.commandTopic, buildIrrigationCommandPayload(command), { qos: 1 });
  return true;
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

export function applyDeviceStatusPayload(
  store: NurseryStore,
  deviceId: string,
  payload: Buffer,
  now: Date = new Date()
): boolean {
  const device = store.devices.get(deviceId);
  const status = parseDeviceStatusPayload(payload);
  if (!device || !status) {
    return false;
  }

  device.status = "online";
  device.lastSeenAt = now;
  if (status.irrigationState) {
    device.irrigationState = status.irrigationState;
  }
  if (Number.isFinite(status.irrigationRemainingSec)) {
    device.irrigationRemainingSec = Math.max(0, Math.floor(status.irrigationRemainingSec ?? 0));
  } else if (status.irrigationState === "off") {
    device.irrigationRemainingSec = 0;
  }
  if (status.mjpegUrl && isAllowedMjpegUrl(status.mjpegUrl)) {
    device.mjpegStreamUrl = status.mjpegUrl;
  }

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
