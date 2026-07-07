import { publishIrrigationCommand } from "../mqtt/mqtt.service.js";
import { AccessControl } from "./access-control.js";
import { AuditService } from "./audit.service.js";
import { createDomainId } from "./id.js";
import { IrrigationCommand, IrrigationSchedule, NurseryStore } from "./types.js";
import { IrrigationCommandService } from "./irrigation-command.service.js";

export interface IrrigationScheduleRequest {
  actorUserId: string;
  deviceId: string;
  type: "one_time" | "daily";
  durationSec: number;
  runAt?: string;
  timeOfDay?: string;
}

export class IrrigationScheduleService {
  private readonly access: AccessControl;
  private readonly audit: AuditService;
  private readonly irrigation: IrrigationCommandService;

  constructor(private readonly store: NurseryStore) {
    this.access = new AccessControl(store);
    this.audit = new AuditService(store);
    this.irrigation = new IrrigationCommandService(store);
  }

  create(input: IrrigationScheduleRequest): IrrigationSchedule {
    this.access.assertCanUseDevice(input.actorUserId, input.deviceId);
    if (!Number.isInteger(input.durationSec) || input.durationSec < 1 || input.durationSec > 900) {
      throw new Error("durationSec must be an integer from 1 to 900");
    }

    const nextRunAt = this.resolveNextRunAt(input);
    const schedule: IrrigationSchedule = {
      id: createDomainId("schedule"),
      actorUserId: input.actorUserId,
      deviceId: input.deviceId,
      type: input.type,
      durationSec: input.durationSec,
      timezone: "Asia/Shanghai",
      runAt: input.runAt ? new Date(input.runAt) : undefined,
      timeOfDay: input.timeOfDay,
      nextRunAt,
      enabled: true,
      createdAt: new Date()
    };
    this.store.irrigationSchedules.set(schedule.id, schedule);
    this.audit.record({
      actorUserId: input.actorUserId,
      action: "irrigation_schedule.created",
      deviceId: input.deviceId,
      metadata: { scheduleId: schedule.id, type: schedule.type, durationSec: schedule.durationSec }
    });
    return schedule;
  }

  listForDevice(actorUserId: string, deviceId: string): IrrigationSchedule[] {
    this.access.assertCanUseDevice(actorUserId, deviceId);
    return Array.from(this.store.irrigationSchedules.values()).filter((schedule) => schedule.deviceId === deviceId);
  }

  delete(actorUserId: string, scheduleId: string): IrrigationSchedule {
    const schedule = this.requireSchedule(scheduleId);
    this.access.assertCanUseDevice(actorUserId, schedule.deviceId);
    schedule.enabled = false;
    this.audit.record({
      actorUserId,
      action: "irrigation_schedule.deleted",
      deviceId: schedule.deviceId,
      metadata: { scheduleId }
    });
    return schedule;
  }

  processDue(
    now: Date = new Date(),
    publish: (command: IrrigationCommand) => boolean = publishIrrigationCommand
  ): IrrigationSchedule[] {
    const ran: IrrigationSchedule[] = [];
    for (const schedule of this.store.irrigationSchedules.values()) {
      if (!schedule.enabled || schedule.nextRunAt.getTime() > now.getTime()) {
        continue;
      }
      const command = this.irrigation.request({
        actorUserId: schedule.actorUserId,
        deviceId: schedule.deviceId,
        durationSec: schedule.durationSec
      });
      try {
        if (!publish(command)) {
          this.irrigation.markFailed(command.id, schedule.deviceId, "MQTT broker is not connected; irrigation command was not sent to device");
          throw new Error("MQTT broker is not connected; irrigation command was not sent to device");
        }
        schedule.lastRunAt = now;
        schedule.failureReason = undefined;
      } catch (error) {
        schedule.failureReason = error instanceof Error ? error.message : "schedule publish failed";
      }
      if (schedule.type === "one_time") {
        schedule.enabled = false;
      } else {
        schedule.nextRunAt = addShanghaiDays(schedule.nextRunAt, 1);
      }
      ran.push(schedule);
    }
    return ran;
  }

  private resolveNextRunAt(input: IrrigationScheduleRequest): Date {
    if (input.type === "one_time") {
      if (!input.runAt) {
        throw new Error("runAt is required for one-time schedules");
      }
      const runAt = new Date(input.runAt);
      if (Number.isNaN(runAt.getTime())) {
        throw new Error("runAt must be an ISO date");
      }
      return runAt;
    }
    if (!input.timeOfDay || !/^\d{2}:\d{2}$/.test(input.timeOfDay)) {
      throw new Error("timeOfDay must use HH:mm");
    }
    return nextShanghaiTimeOfDay(input.timeOfDay);
  }

  private requireSchedule(scheduleId: string): IrrigationSchedule {
    const schedule = this.store.irrigationSchedules.get(scheduleId);
    if (!schedule) {
      throw new Error("Irrigation schedule not found");
    }
    return schedule;
  }
}

function nextShanghaiTimeOfDay(timeOfDay: string, now: Date = new Date()): Date {
  const [hourText, minuteText] = timeOfDay.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const shanghaiNow = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const candidate = new Date(
    Date.UTC(
      shanghaiNow.getUTCFullYear(),
      shanghaiNow.getUTCMonth(),
      shanghaiNow.getUTCDate(),
      hour - 8,
      minute,
      0,
      0
    )
  );
  if (candidate.getTime() <= now.getTime()) {
    return addShanghaiDays(candidate, 1);
  }
  return candidate;
}

function addShanghaiDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * 24 * 60 * 60 * 1000);
}
