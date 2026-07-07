import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";
import { appState } from "../app-state.js";
import {
  DeviceStatus,
  IrrigationCommandStatus,
  IrrigationScheduleType,
  IrrigationState,
  UserRole,
  VideoMode
} from "../domain/types.js";

@Injectable()
export class PrismaPersistenceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaPersistenceService.name);
  private readonly prisma = new PrismaClient();
  private timer?: NodeJS.Timeout;
  private syncing = false;
  private enabled = false;

  async onModuleInit() {
    if (process.env.NODE_ENV === "test" || !process.env.DATABASE_URL) {
      return;
    }

    try {
      await this.prisma.$connect();
      this.enabled = true;
      await this.bootstrapStore();
      this.timer = setInterval(() => void this.persistSnapshot(), 5000);
      this.timer.unref?.();
      this.logger.log("Prisma persistence enabled");
    } catch (error) {
      this.enabled = false;
      this.logger.error(error instanceof Error ? error.message : "Prisma persistence failed");
    }
  }

  async onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
    }
    if (this.enabled) {
      await this.persistSnapshot();
      await this.prisma.$disconnect();
    }
  }

  private async bootstrapStore() {
    const [userCount, deviceCount] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.device.count()
    ]);

    if (userCount === 0 && deviceCount === 0) {
      await this.persistSnapshot();
      return;
    }

    await this.loadSnapshot();
  }

  private async loadSnapshot() {
    const [
      users,
      customers,
      devices,
      deviceLayouts,
      assignments,
      commands,
      schedules,
      videoSessions,
      shareLinks,
      auditLogs
    ] = await Promise.all([
      this.prisma.user.findMany(),
      this.prisma.customer.findMany(),
      this.prisma.device.findMany(),
      this.prisma.deviceLayout.findMany(),
      this.prisma.deviceAssignment.findMany(),
      this.prisma.irrigationCommand.findMany(),
      this.prisma.irrigationSchedule.findMany(),
      this.prisma.videoSession.findMany(),
      this.prisma.customerShareLink.findMany(),
      this.prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 200 })
    ]);

    const store = appState.store;
    store.users = new Map(
      users.map((user) => [
        user.id,
        {
          id: user.id,
          email: user.email,
          name: user.name,
          passwordHash: user.passwordHash,
          role: user.role as UserRole,
          customerId: user.customerId ?? undefined
        }
      ])
    );
    store.customers = new Map(customers.map((customer) => [customer.id, customer]));
    store.devices = new Map(
      devices.map((device) => [
        device.id,
        {
          id: device.id,
          displayName: device.displayName,
          location: device.location,
          status: device.status as DeviceStatus,
          irrigationState: device.irrigationState as IrrigationState,
          irrigationRemainingSec: device.irrigationRemainingSec ?? undefined,
          lastSeenAt: device.lastSeenAt ?? undefined,
          mjpegStreamUrl: device.mjpegStreamUrl ?? undefined,
          mqttStatusTopic: device.mqttStatusTopic,
          mqttEventsTopic: device.mqttEventsTopic
        }
      ])
    );
    store.deviceLayouts = new Map(
      deviceLayouts.map((layout) => [
        layout.deviceId,
        {
          deviceId: layout.deviceId,
          title: layout.title,
          xPct: layout.xPct,
          yPct: layout.yPct,
          widthPct: layout.widthPct,
          heightPct: layout.heightPct,
          zIndex: layout.zIndex,
          updatedAt: layout.updatedAt
        }
      ])
    );
    store.assignments = new Map(
      assignments.map((assignment) => [
        assignment.id,
        { id: assignment.id, customerId: assignment.customerId, deviceId: assignment.deviceId }
      ])
    );
    store.irrigationCommands = new Map(
      commands.map((command) => [
        command.id,
        {
          id: command.id,
          actorUserId: command.actorUserId,
          deviceId: command.deviceId,
          durationSec: command.durationSec,
          status: command.status as IrrigationCommandStatus,
          requestedAt: command.requestedAt,
          startedAt: command.startedAt ?? undefined,
          completedAt: command.completedAt ?? undefined,
          failureReason: command.failureReason ?? undefined,
          commandTopic: command.commandTopic
        }
      ])
    );
    store.irrigationSchedules = new Map(
      schedules.map((schedule) => [
        schedule.id,
        {
          id: schedule.id,
          actorUserId: schedule.actorUserId,
          deviceId: schedule.deviceId,
          type: schedule.type as IrrigationScheduleType,
          durationSec: schedule.durationSec,
          timezone: "Asia/Shanghai",
          runAt: schedule.runAt ?? undefined,
          timeOfDay: schedule.timeOfDay ?? undefined,
          nextRunAt: schedule.nextRunAt,
          enabled: schedule.enabled,
          lastRunAt: schedule.lastRunAt ?? undefined,
          failureReason: schedule.failureReason ?? undefined,
          createdAt: schedule.createdAt
        }
      ])
    );
    store.videoSessions = new Map(
      videoSessions.map((session) => [
        session.id,
        {
          id: session.id,
          actorUserId: session.actorUserId,
          deviceId: session.deviceId,
          mode: session.mode as VideoMode,
          createdAt: session.createdAt,
          signalingTopic: session.signalingTopic,
          mjpegUrl: session.mjpegUrl ?? undefined
        }
      ])
    );
    store.shareLinks = new Map(
      shareLinks.map((link) => [
        link.id,
        {
          id: link.id,
          customerId: link.customerId,
          deviceId: link.deviceId ?? "",
          tokenHash: link.tokenHash,
          createdByUserId: link.createdByUserId,
          createdAt: link.createdAt,
          expiresAt: link.expiresAt,
          revokedAt: link.revokedAt ?? undefined
        }
      ])
    );
    store.auditLogs = auditLogs.map((log) => ({
      id: log.id,
      actorUserId: log.actorUserId,
      action: log.action,
      deviceId: log.deviceId ?? undefined,
      metadata: typeof log.metadata === "object" && log.metadata !== null ? (log.metadata as Record<string, unknown>) : {},
      createdAt: log.createdAt
    }));
  }

  private async persistSnapshot() {
    if (!this.enabled || this.syncing) {
      return;
    }
    this.syncing = true;

    try {
      const store = appState.store;
      for (const customer of store.customers.values()) {
        await this.prisma.customer.upsert({
          where: { id: customer.id },
          create: customer,
          update: { name: customer.name, contactEmail: customer.contactEmail }
        });
      }

      for (const user of store.users.values()) {
        await this.prisma.user.upsert({
          where: { id: user.id },
          create: {
            id: user.id,
            email: user.email,
            name: user.name,
            passwordHash: user.passwordHash,
            role: user.role,
            customerId: user.customerId
          },
          update: {
            email: user.email,
            name: user.name,
            passwordHash: user.passwordHash,
            role: user.role,
            customerId: user.customerId
          }
        });
      }

      for (const device of store.devices.values()) {
        await this.prisma.device.upsert({
          where: { id: device.id },
          create: {
            id: device.id,
            displayName: device.displayName,
            location: device.location,
            status: device.status,
            irrigationState: device.irrigationState,
            irrigationRemainingSec: device.irrigationRemainingSec,
            lastSeenAt: device.lastSeenAt,
            mjpegStreamUrl: device.mjpegStreamUrl,
            mqttStatusTopic: device.mqttStatusTopic,
            mqttEventsTopic: device.mqttEventsTopic
          },
          update: {
            displayName: device.displayName,
            location: device.location,
            status: device.status,
            irrigationState: device.irrigationState,
            irrigationRemainingSec: device.irrigationRemainingSec,
            lastSeenAt: device.lastSeenAt,
            mjpegStreamUrl: device.mjpegStreamUrl,
            mqttStatusTopic: device.mqttStatusTopic,
            mqttEventsTopic: device.mqttEventsTopic
          }
        });
      }

      for (const assignment of store.assignments.values()) {
        await this.prisma.deviceAssignment.upsert({
          where: { id: assignment.id },
          create: assignment,
          update: { customerId: assignment.customerId, deviceId: assignment.deviceId }
        });
      }

      for (const layout of store.deviceLayouts.values()) {
        await this.prisma.deviceLayout.upsert({
          where: { deviceId: layout.deviceId },
          create: {
            deviceId: layout.deviceId,
            title: layout.title,
            xPct: layout.xPct,
            yPct: layout.yPct,
            widthPct: layout.widthPct,
            heightPct: layout.heightPct,
            zIndex: layout.zIndex
          },
          update: {
            title: layout.title,
            xPct: layout.xPct,
            yPct: layout.yPct,
            widthPct: layout.widthPct,
            heightPct: layout.heightPct,
            zIndex: layout.zIndex
          }
        });
      }

      for (const command of store.irrigationCommands.values()) {
        await this.prisma.irrigationCommand.upsert({
          where: { id: command.id },
          create: command,
          update: {
            status: command.status,
            startedAt: command.startedAt,
            completedAt: command.completedAt,
            failureReason: command.failureReason
          }
        });
      }

      for (const schedule of store.irrigationSchedules.values()) {
        await this.prisma.irrigationSchedule.upsert({
          where: { id: schedule.id },
          create: schedule,
          update: {
            durationSec: schedule.durationSec,
            runAt: schedule.runAt,
            timeOfDay: schedule.timeOfDay,
            nextRunAt: schedule.nextRunAt,
            enabled: schedule.enabled,
            lastRunAt: schedule.lastRunAt,
            failureReason: schedule.failureReason
          }
        });
      }

      for (const session of store.videoSessions.values()) {
        await this.prisma.videoSession.upsert({
          where: { id: session.id },
          create: session,
          update: {
            mode: session.mode,
            signalingTopic: session.signalingTopic,
            mjpegUrl: session.mjpegUrl
          }
        });
      }

      for (const link of store.shareLinks.values()) {
        await this.prisma.customerShareLink.upsert({
          where: { id: link.id },
          create: link,
          update: {
            deviceId: link.deviceId,
            expiresAt: link.expiresAt,
            revokedAt: link.revokedAt
          }
        });
      }

      for (const log of store.auditLogs) {
        await this.prisma.auditLog.upsert({
          where: { id: log.id },
          create: {
            id: log.id,
            actorUserId: log.actorUserId,
            action: log.action,
            deviceId: log.deviceId,
            metadata: log.metadata as Prisma.InputJsonValue,
            createdAt: log.createdAt
          },
          update: {}
        });
      }
    } catch (error) {
      this.logger.warn(error instanceof Error ? error.message : "Prisma persistence snapshot failed");
    } finally {
      this.syncing = false;
    }
  }
}
