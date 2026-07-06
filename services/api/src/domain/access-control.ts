import { NurseryStore, User, Device } from "./types.js";

export class AccessControl {
  constructor(private readonly store: NurseryStore) {}

  requireUser(userId: string): User {
    const user = this.store.users.get(userId);
    if (!user) {
      throw new Error("User not found");
    }
    return user;
  }

  requireDevice(deviceId: string): Device {
    const device = this.store.devices.get(deviceId);
    if (!device) {
      throw new Error("Device not found");
    }
    return device;
  }

  assertCanUseDevice(userId: string, deviceId: string): void {
    const user = this.requireUser(userId);
    this.requireDevice(deviceId);

    if (user.role === "platform_admin") {
      return;
    }

    if (!user.customerId) {
      throw new Error("Customer user is missing customer scope");
    }

    const assigned = Array.from(this.store.assignments.values()).some(
      (assignment) => assignment.customerId === user.customerId && assignment.deviceId === deviceId
    );

    if (!assigned) {
      throw new Error("Device is not assigned to this customer");
    }
  }
}
