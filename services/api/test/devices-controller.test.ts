import { ForbiddenException, NotFoundException, ServiceUnavailableException, StreamableFile, UnauthorizedException } from "@nestjs/common";
import jwt from "jsonwebtoken";
import { describe, expect, it } from "vitest";
import { appState } from "../src/app-state.js";
import { DevicesController, ensureIrrigationCommandPublished } from "../src/devices/devices.controller.js";

describe("DevicesController", () => {
  it("requires authorization before listing devices", () => {
    const controller = new DevicesController();

    expect(() => controller.list()).toThrow(UnauthorizedException);
  });

  it("maps customer access to an unassigned device to a forbidden response", () => {
    const controller = new DevicesController();
    const customerToken = jwt.sign({ sub: "user-customer-north", role: "customer" }, "dev-only-change-me");

    expect(() =>
      controller.irrigate("device-south-01", { durationSec: 45 }, `Bearer ${customerToken}`)
    ).toThrow(ForbiddenException);
  });

  it("does not report irrigation success when the MQTT bridge is offline", () => {
    const command = appState.irrigation.request({
      actorUserId: "user-admin",
      deviceId: "device-north-01",
      durationSec: 12
    });

    expect(() => ensureIrrigationCommandPublished(command, () => false)).toThrow(ServiceUnavailableException);
    expect(appState.store.irrigationCommands.get(command.id)?.status).toBe("failed");
  });

  it("returns the latest relayed MJPEG frame for assigned devices", () => {
    const controller = new DevicesController();
    const adminToken = jwt.sign({ sub: "user-admin", role: "platform_admin" }, "dev-only-change-me");
    appState.store.latestMjpegFrames.set("device-north-01", {
      data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
      contentType: "image/jpeg",
      updatedAt: new Date("2026-07-07T00:00:00.000Z")
    });

    const file = controller.getLatestMjpegFrame("device-north-01", `Bearer ${adminToken}`);

    expect(file).toBeInstanceOf(StreamableFile);
  });

  it("accepts a query token for image tags that cannot send authorization headers", () => {
    const controller = new DevicesController();
    const adminToken = jwt.sign({ sub: "user-admin", role: "platform_admin" }, "dev-only-change-me");
    appState.store.latestMjpegFrames.set("device-north-01", {
      data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
      contentType: "image/jpeg",
      updatedAt: new Date("2026-07-07T00:00:00.000Z")
    });

    const file = controller.getLatestMjpegFrame("device-north-01", undefined, adminToken);

    expect(file).toBeInstanceOf(StreamableFile);
  });

  it("applies query token authorization before returning relayed MJPEG frames", () => {
    const controller = new DevicesController();
    const customerToken = jwt.sign({ sub: "user-customer-north", role: "customer" }, "dev-only-change-me");
    appState.store.latestMjpegFrames.set("device-south-01", {
      data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
      contentType: "image/jpeg",
      updatedAt: new Date("2026-07-07T00:00:00.000Z")
    });

    expect(() => controller.getLatestMjpegFrame("device-south-01", undefined, customerToken)).toThrow(ForbiddenException);
  });


  it("returns not found when no relayed MJPEG frame exists", () => {
    const controller = new DevicesController();
    const adminToken = jwt.sign({ sub: "user-admin", role: "platform_admin" }, "dev-only-change-me");
    appState.store.latestMjpegFrames.delete("device-south-01");

    expect(() => controller.getLatestMjpegFrame("device-south-01", `Bearer ${adminToken}`)).toThrow(NotFoundException);
  });
});
