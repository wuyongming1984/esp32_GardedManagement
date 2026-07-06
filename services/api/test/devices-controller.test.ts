import { ForbiddenException } from "@nestjs/common";
import jwt from "jsonwebtoken";
import { describe, expect, it } from "vitest";
import { DevicesController } from "../src/devices/devices.controller.js";

describe("DevicesController", () => {
  it("maps customer access to an unassigned device to a forbidden response", () => {
    const controller = new DevicesController();
    const customerToken = jwt.sign({ sub: "user-customer-north", role: "customer" }, "dev-only-change-me");

    expect(() =>
      controller.irrigate("device-south-01", { durationSec: 45 }, `Bearer ${customerToken}`)
    ).toThrow(ForbiddenException);
  });
});
