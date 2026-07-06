import { describe, expect, it } from "vitest";
import { isAllowedMjpegUrl, parseDeviceStatusPayload } from "../src/mqtt/mqtt.service.js";

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
});
