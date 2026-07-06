import { DeviceService } from "./device.service.js";
import { NurseryStore, User } from "./types.js";

const northDeviceMjpegUrl =
  process.env.NURSERY_DEVICE_NORTH_MJPEG_URL ?? "http://192.168.110.184:8080/stream.mjpg";

export function createEmptyStore(): NurseryStore {
  return {
    users: new Map(),
    customers: new Map(),
    devices: new Map(),
    assignments: new Map(),
    irrigationCommands: new Map(),
    videoSessions: new Map(),
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
    role: "platform_admin"
  };
  const customer: User = {
    id: "user-customer-north",
    email: "north-client@example.com",
    name: "North Client",
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

  return {
    store,
    users: { admin, customer },
    devices: new DeviceService(store)
  };
}
