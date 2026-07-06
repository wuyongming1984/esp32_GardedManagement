import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import mqtt from "mqtt";
import { appState } from "../app-state.js";

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
    });

    client.on("message", (topic, payload) => {
      const [, deviceId, channel] = topic.split("/");
      const device = appState.store.devices.get(deviceId);
      if (!device) {
        return;
      }
      if (channel === "status") {
        device.status = "online";
        device.lastSeenAt = new Date();
      }
      if (channel === "events") {
        this.logger.log(`Device event ${deviceId}: ${payload.toString()}`);
      }
    });
  }
}
