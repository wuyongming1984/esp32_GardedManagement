import { AccessControl } from "./access-control.js";
import { Device, NurseryStore } from "./types.js";

export class DeviceService {
  private readonly access: AccessControl;

  constructor(private readonly store: NurseryStore) {
    this.access = new AccessControl(store);
  }

  listForUser(userId: string): Device[] {
    const user = this.access.requireUser(userId);

    if (user.role === "platform_admin") {
      return Array.from(this.store.devices.values());
    }

    if (!user.customerId) {
      return [];
    }

    const assignedIds = new Set(
      Array.from(this.store.assignments.values())
        .filter((assignment) => assignment.customerId === user.customerId)
        .map((assignment) => assignment.deviceId)
    );

    return Array.from(this.store.devices.values()).filter((device) => assignedIds.has(device.id));
  }

  getForUser(userId: string, deviceId: string): Device {
    this.access.assertCanUseDevice(userId, deviceId);
    return this.access.requireDevice(deviceId);
  }
}
