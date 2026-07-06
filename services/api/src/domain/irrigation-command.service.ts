import { AccessControl } from "./access-control.js";
import { AuditService } from "./audit.service.js";
import { IrrigationCommand, NurseryStore } from "./types.js";

let commandCounter = 0;

export interface IrrigationRequest {
  actorUserId: string;
  deviceId: string;
  durationSec: number;
}

export class IrrigationCommandService {
  private readonly access: AccessControl;
  private readonly audit: AuditService;

  constructor(private readonly store: NurseryStore) {
    this.access = new AccessControl(store);
    this.audit = new AuditService(store);
  }

  request(input: IrrigationRequest): IrrigationCommand {
    this.access.assertCanUseDevice(input.actorUserId, input.deviceId);
    if (!Number.isInteger(input.durationSec) || input.durationSec < 1 || input.durationSec > 900) {
      throw new Error("durationSec must be an integer from 1 to 900");
    }

    const command: IrrigationCommand = {
      id: `irrigation-${++commandCounter}`,
      actorUserId: input.actorUserId,
      deviceId: input.deviceId,
      durationSec: input.durationSec,
      status: "queued",
      requestedAt: new Date(),
      commandTopic: `devices/${input.deviceId}/commands/irrigation/irrigation-${commandCounter}`
    };
    this.store.irrigationCommands.set(command.id, command);
    this.audit.record({
      actorUserId: input.actorUserId,
      action: "irrigation.requested",
      deviceId: input.deviceId,
      metadata: { durationSec: input.durationSec, commandId: command.id }
    });
    return command;
  }

  markRunning(commandId: string, deviceId: string): IrrigationCommand {
    const command = this.requireCommand(commandId, deviceId);
    command.status = "running";
    command.startedAt = new Date();
    const device = this.access.requireDevice(deviceId);
    device.irrigationState = "on";
    this.audit.record({
      actorUserId: command.actorUserId,
      action: "irrigation.running",
      deviceId,
      metadata: { commandId }
    });
    return command;
  }

  expireOverdueCommands(nowMs = Date.now()): IrrigationCommand[] {
    const completed: IrrigationCommand[] = [];
    for (const command of this.store.irrigationCommands.values()) {
      if (command.status !== "running") {
        continue;
      }
      const startedMs = command.startedAt?.getTime() ?? command.requestedAt.getTime();
      if (startedMs + command.durationSec * 1000 <= nowMs) {
        command.status = "completed";
        command.completedAt = new Date(nowMs);
        const device = this.access.requireDevice(command.deviceId);
        device.irrigationState = "off";
        completed.push(command);
        this.audit.record({
          actorUserId: command.actorUserId,
          action: "irrigation.completed",
          deviceId: command.deviceId,
          metadata: { commandId: command.id }
        });
      }
    }
    return completed;
  }

  failDevice(deviceId: string, reason: string): void {
    const device = this.access.requireDevice(deviceId);
    device.status = "fault";
    device.irrigationState = "off";

    for (const command of this.store.irrigationCommands.values()) {
      if (command.deviceId === deviceId && command.status === "running") {
        command.status = "failed";
        command.completedAt = new Date();
        command.failureReason = reason;
        this.audit.record({
          actorUserId: command.actorUserId,
          action: "irrigation.failed_safe_off",
          deviceId,
          metadata: { commandId: command.id, reason }
        });
      }
    }
  }

  private requireCommand(commandId: string, deviceId: string): IrrigationCommand {
    const command = this.store.irrigationCommands.get(commandId);
    if (!command || command.deviceId !== deviceId) {
      throw new Error("Irrigation command not found for device");
    }
    return command;
  }
}
