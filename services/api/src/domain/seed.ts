import { DeviceService } from "./device.service.js";
import { NurseryStore, User } from "./types.js";
import { hashPassword } from "../auth/security.js";

const northDeviceMjpegUrl =
  process.env.NURSERY_DEVICE_NORTH_MJPEG_URL ?? "http://192.168.110.184:8080/stream.mjpg";

export function createEmptyStore(): NurseryStore {
  return {
    users: new Map(),
    customers: new Map(),
    devices: new Map(),
    deviceLayouts: new Map(),
    assignments: new Map(),
    irrigationCommands: new Map(),
    irrigationSchedules: new Map(),
    videoSessions: new Map(),
    shareLinks: new Map(),
    latestMjpegFrames: new Map(),
    auditLogs: []
  };
}

export function createSeededNurseryDomain() {
  const store = createEmptyStore();
  const admin: User = {
    id: "user-admin",
    email: "admin@nursery.local",
    name: "Platform Admin",
    passwordHash: hashPassword(process.env.ADMIN_INITIAL_PASSWORD ?? "change-me-now"),
    role: "platform_admin"
  };
  const customer: User = {
    id: "user-customer-north",
    email: "north-client@example.com",
    name: "North Client",
    passwordHash: hashPassword("change-me-now"),
    role: "customer",
    customerId: "customer-north"
  };

  store.users.set(admin.id, admin);
  store.users.set(customer.id, customer);
  store.customers.set("customer-north", {
    id: "customer-north",
    name: "North Nursery Customer",
    contactEmail: "north-client@example.com"
  });
  store.devices.set("device-north-01", {
    id: "device-north-01",
    displayName: "North Greenhouse P4",
    location: "North greenhouse bench A",
    status: "online",
    irrigationState: "off",
    lastSeenAt: new Date("2026-07-06T00:00:00.000Z"),
    mjpegStreamUrl: northDeviceMjpegUrl,
    mqttStatusTopic: "devices/device-north-01/status",
    mqttEventsTopic: "devices/device-north-01/events"
  });
  store.devices.set("device-south-01", {
    id: "device-south-01",
    displayName: "South Propagation Bench",
    location: "South propagation bench",
    status: "offline",
    irrigationState: "off",
    mqttStatusTopic: "devices/device-south-01/status",
    mqttEventsTopic: "devices/device-south-01/events"
  });
  store.assignments.set("assignment-north-01", {
    id: "assignment-north-01",
    customerId: "customer-north",
    deviceId: "device-north-01"
  });
  store.deviceLayouts.set("device-north-01", {
    deviceId: "device-north-01",
    title: "北区温室 A 苗床",
    xPct: 9,
    yPct: 12,
    widthPct: 30,
    heightPct: 24,
    zIndex: 2,
    updatedAt: new Date("2026-07-06T00:00:00.000Z")
  });
  store.deviceLayouts.set("device-south-01", {
    deviceId: "device-south-01",
    title: "南区育苗台",
    xPct: 52,
    yPct: 38,
    widthPct: 28,
    heightPct: 22,
    zIndex: 1,
    updatedAt: new Date("2026-07-06T00:00:00.000Z")
  });

  return {
    store,
    users: { admin, customer },
    devices: new DeviceService(store)
  };
}
