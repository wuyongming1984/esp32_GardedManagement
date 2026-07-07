import { ForbiddenException, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import jwt from "jsonwebtoken";
import { describe, expect, it } from "vitest";
import { AdminController } from "../src/admin/admin.controller.js";
import { appState } from "../src/app-state.js";
import { AuthController, actorContextFromAuthorizationHeader } from "../src/auth/auth.controller.js";
import { DevicesController } from "../src/devices/devices.controller.js";

const adminAuth = `Bearer ${jwt.sign({ sub: "user-admin", role: "platform_admin" }, "dev-only-change-me")}`;
const customerAuth = `Bearer ${jwt.sign({ sub: "user-customer-north", role: "customer" }, "dev-only-change-me")}`;

describe("account management", () => {
  it("requires a password during login and allows the current user to update profile fields", async () => {
    const controller = new AuthController();

    await expect(
      Promise.resolve().then(() => controller.login({ email: "admin@nursery.local", password: "wrong-password" }))
    ).rejects.toThrow(UnauthorizedException);

    const login = await controller.login({ email: "admin@nursery.local", password: "change-me-now" });
    expect(login.accessToken).toEqual(expect.any(String));

    const updated = controller.updateMe({ name: "管理员", email: "admin@nursery.local" }, adminAuth);
    expect(updated.name).toBe("管理员");
  });

  it("changes the current user's password after validating the old password", async () => {
    const controller = new AuthController();
    const uniqueEmail = `password-test-${Date.now()}@nursery.local`;
    appState.store.users.set("user-password-test", {
      id: "user-password-test",
      email: uniqueEmail,
      name: "Password Test",
      role: "customer",
      customerId: "customer-north",
      passwordHash: appState.auth.hashPassword("old-pass-123")
    });
    const auth = `Bearer ${jwt.sign({ sub: "user-password-test", role: "customer" }, "dev-only-change-me")}`;

    await expect(
      Promise.resolve().then(() => controller.changePassword({ currentPassword: "bad-pass", newPassword: "new-pass-123" }, auth))
    ).rejects.toThrow(UnauthorizedException);

    await controller.changePassword({ currentPassword: "old-pass-123", newPassword: "new-pass-123" }, auth);
    expect(controller.login({ email: uniqueEmail, password: "new-pass-123" })).toMatchObject({
      user: { id: "user-password-test" }
    });
  });
});

describe("admin share links and device paging", () => {
  it("lists devices with paging and search for 100-device operations", () => {
    const controller = new AdminController();
    for (let index = 1; index <= 15; index++) {
      const id = `bulk-device-${index.toString().padStart(3, "0")}`;
      appState.store.devices.set(id, {
        id,
        displayName: `批量设备 ${index}`,
        location: `测试苗床 ${index}`,
        status: index % 2 === 0 ? "online" : "offline",
        irrigationState: "off",
        mqttStatusTopic: `devices/${id}/status`,
        mqttEventsTopic: `devices/${id}/events`
      });
    }

    const page = controller.devices(adminAuth, { search: "批量设备", status: "online", page: "1", pageSize: "5" });

    expect(page.total).toBeGreaterThanOrEqual(7);
    expect(page.items).toHaveLength(5);
    expect(page.items.every((device) => device.status === "online")).toBe(true);
  });

  it("generates revocable device share links that can manage only the selected device", () => {
    const admin = new AdminController();
    const auth = new AuthController();

    const link = admin.createShareLink({ customerId: "customer-north", deviceId: "device-north-01" }, adminAuth);
    expect(link.url).toMatch(/\/share\//);
    expect(link.deviceId).toBe("device-north-01");

    const token = link.url.split("/share/")[1];
    const exchanged = auth.exchangeShareLink(token);
    const context = actorContextFromAuthorizationHeader(`Bearer ${exchanged.accessToken}`);
    expect(context.scope).toBe("share");
    expect(context.deviceId).toBe("device-north-01");

    const devices = new DevicesController();
    expect(devices.list(`Bearer ${exchanged.accessToken}`).map((device) => device.id)).toEqual(["device-north-01"]);
    expect(() =>
      devices.irrigate("device-south-01", { durationSec: 10 }, `Bearer ${exchanged.accessToken}`)
    ).toThrow(ForbiddenException);

    const commandCount = appState.store.irrigationCommands.size;
    expect(() =>
      devices.irrigate("device-north-01", { durationSec: 10 }, `Bearer ${exchanged.accessToken}`)
    ).toThrow(ServiceUnavailableException);
    expect(appState.store.irrigationCommands.size).toBe(commandCount + 1);

    const schedule = devices.createSchedule(
      "device-north-01",
      { type: "one_time", durationSec: 10, runAt: "2026-07-08T00:00:00.000Z" },
      `Bearer ${exchanged.accessToken}`
    );
    expect(schedule.deviceId).toBe("device-north-01");
    expect(() =>
      devices.createSchedule(
        "device-south-01",
        { type: "one_time", durationSec: 10, runAt: "2026-07-08T00:00:00.000Z" },
        `Bearer ${exchanged.accessToken}`
      )
    ).toThrow(ForbiddenException);

    admin.revokeShareLink(link.id, adminAuth);
    expect(() => auth.exchangeShareLink(token)).toThrow(UnauthorizedException);
  });
});

describe("irrigation schedules", () => {
  it("runs due one-time schedules once and daily schedules repeatedly", () => {
    const devices = new DevicesController();
    const oneTime = devices.createSchedule(
      "device-north-01",
      {
        type: "one_time",
        durationSec: 20,
        runAt: "2026-07-07T00:00:00.000Z"
      },
      adminAuth
    );
    const daily = devices.createSchedule(
      "device-north-01",
      {
        type: "daily",
        durationSec: 30,
        timeOfDay: "08:30"
      },
      adminAuth
    );
    appState.store.irrigationSchedules.get(daily.id)!.nextRunAt = new Date("2026-07-07T00:30:00.000Z");

    const published: string[] = [];
    const ran = appState.schedules.processDue(new Date("2026-07-07T00:30:10.000Z"), (command) => {
      published.push(command.id);
      return true;
    });

    expect(ran.map((schedule) => schedule.id)).toContain(oneTime.id);
    expect(ran.map((schedule) => schedule.id)).toContain(daily.id);
    expect(appState.store.irrigationSchedules.get(oneTime.id)?.enabled).toBe(false);
    expect(appState.store.irrigationSchedules.get(daily.id)?.nextRunAt.toISOString()).toBe("2026-07-08T00:30:00.000Z");
    expect(published).toHaveLength(2);
  });
});
