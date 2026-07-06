import { describe, expect, it } from "vitest";
import { createSeededNurseryDomain } from "../src/domain/seed.js";
import { IrrigationCommandService } from "../src/domain/irrigation-command.service.js";
import { VideoSessionService } from "../src/domain/video-session.service.js";

describe("nursery MVP domain", () => {
  it("allows platform admin to see every device and customers to see only assigned devices", () => {
    const domain = createSeededNurseryDomain();

    expect(domain.devices.listForUser(domain.users.admin.id).map((device) => device.id)).toEqual([
      "device-north-01",
      "device-south-01"
    ]);
    expect(domain.devices.listForUser(domain.users.customer.id).map((device) => device.id)).toEqual([
      "device-north-01"
    ]);
  });

  it("creates limited irrigation commands that default to safe-off on expiry and device fault", () => {
    const domain = createSeededNurseryDomain();
    const irrigation = new IrrigationCommandService(domain.store);

    const command = irrigation.request({
      actorUserId: domain.users.customer.id,
      deviceId: "device-north-01",
      durationSec: 45
    });

    expect(command.status).toBe("queued");
    irrigation.markRunning(command.id, "device-north-01");
    expect(domain.store.irrigationCommands.get(command.id)?.status).toBe("running");

    irrigation.expireOverdueCommands(command.requestedAt.getTime() + 46_000);
    expect(domain.store.irrigationCommands.get(command.id)?.status).toBe("completed");
    expect(domain.store.devices.get("device-north-01")?.irrigationState).toBe("off");

    const faultCommand = irrigation.request({
      actorUserId: domain.users.admin.id,
      deviceId: "device-south-01",
      durationSec: 30
    });
    irrigation.markRunning(faultCommand.id, "device-south-01");
    irrigation.failDevice("device-south-01", "mqtt disconnect");

    expect(domain.store.irrigationCommands.get(faultCommand.id)?.status).toBe("failed");
    expect(domain.store.devices.get("device-south-01")?.irrigationState).toBe("off");
  });

  it("opens video sessions in WebRTC mode and falls back to MJPEG when requested", () => {
    const domain = createSeededNurseryDomain();
    const video = new VideoSessionService(domain.store);

    const webrtc = video.open({
      actorUserId: domain.users.customer.id,
      deviceId: "device-north-01",
      preferredMode: "webrtc"
    });
    const mjpeg = video.open({
      actorUserId: domain.users.customer.id,
      deviceId: "device-north-01",
      preferredMode: "mjpeg"
    });

    expect(webrtc.mode).toBe("webrtc");
    expect(webrtc.signalingTopic).toBe("devices/device-north-01/video/signaling/" + webrtc.id);
    expect(mjpeg.mode).toBe("mjpeg");
    expect(mjpeg.mjpegUrl).toBe("http://192.168.110.184:8080/stream.mjpg");
  });

  it("rejects customer access to unassigned devices", () => {
    const domain = createSeededNurseryDomain();
    const irrigation = new IrrigationCommandService(domain.store);
    const video = new VideoSessionService(domain.store);

    expect(() =>
      irrigation.request({
        actorUserId: domain.users.customer.id,
        deviceId: "device-south-01",
        durationSec: 30
      })
    ).toThrow("Device is not assigned to this customer");

    expect(() =>
      video.open({
        actorUserId: domain.users.customer.id,
        deviceId: "device-south-01",
        preferredMode: "webrtc"
      })
    ).toThrow("Device is not assigned to this customer");
  });
});
