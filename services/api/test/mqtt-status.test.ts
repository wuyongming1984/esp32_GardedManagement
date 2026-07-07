import { describe, expect, it } from "vitest";
import { createSeededNurseryDomain } from "../src/domain/seed.js";
import {
  applyDeviceStatusPayload,
  buildIrrigationCommandPayload,
  isAllowedMjpegUrl,
  parseDeviceStatusPayload,
  storeDeviceMjpegFrame
} from "../src/mqtt/mqtt.service.js";

describe("MQTT device status parsing", () => {
  it("accepts device MJPEG stream URLs from status payloads", () => {
    const payload = Buffer.from(
      JSON.stringify({
        status: "online",
        irrigationState: "off",
        localIp: "192.168.110.184",
        mjpegUrl: "http://192.168.110.184:8080/stream.mjpg"
      })
    );

    expect(parseDeviceStatusPayload(payload)).toMatchObject({
      irrigationState: "off",
      mjpegUrl: "http://192.168.110.184:8080/stream.mjpg"
    });
    expect(isAllowedMjpegUrl("http://192.168.110.184:8080/stream.mjpg")).toBe(true);
  });

  it("rejects non-stream MJPEG URLs", () => {
    expect(isAllowedMjpegUrl("https://example.com/stream.mjpg")).toBe(false);
    expect(isAllowedMjpegUrl("http://example.com/admin")).toBe(false);
    expect(isAllowedMjpegUrl("not-a-url")).toBe(false);
  });

  it("stores relayed MJPEG frames behind a public API URL", () => {
    const domain = createSeededNurseryDomain();
    const frame = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

    const stored = storeDeviceMjpegFrame(domain.store, "device-north-01", frame, new Date("2026-07-07T00:00:00.000Z"));

    expect(stored).toBe(true);
    expect(domain.store.devices.get("device-north-01")?.mjpegStreamUrl).toBe("/api/devices/device-north-01/mjpeg/latest.jpg");
    expect(domain.store.latestMjpegFrames.get("device-north-01")).toMatchObject({
      contentType: "image/jpeg",
      updatedAt: new Date("2026-07-07T00:00:00.000Z")
    });
    expect(domain.store.latestMjpegFrames.get("device-north-01")?.data.equals(frame)).toBe(true);
  });

  it("applies device-originated irrigation countdown status to the store", () => {
    const domain = createSeededNurseryDomain();

    const updated = applyDeviceStatusPayload(
      domain.store,
      "device-north-01",
      Buffer.from(
        JSON.stringify({
          status: "online",
          irrigationState: "on",
          irrigationRemainingSec: 12,
          mjpegUrl: "http://192.168.110.184:8080/stream.mjpg"
        })
      ),
      new Date("2026-07-07T01:02:03.000Z")
    );

    const device = domain.store.devices.get("device-north-01");
    expect(updated).toBe(true);
    expect(device?.status).toBe("online");
    expect(device?.lastSeenAt).toEqual(new Date("2026-07-07T01:02:03.000Z"));
    expect(device?.irrigationState).toBe("on");
    expect(device?.irrigationRemainingSec).toBe(12);
    expect(device?.mjpegStreamUrl).toBe("http://192.168.110.184:8080/stream.mjpg");
  });

  it("builds irrigation command payloads for device MQTT handlers", () => {
    const payload = buildIrrigationCommandPayload({
      id: "irrigation-42",
      durationSec: 30
    });

    expect(JSON.parse(payload)).toEqual({
      commandId: "irrigation-42",
      durationSec: 30,
      source: "pc"
    });
  });
});
