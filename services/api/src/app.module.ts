import { Module } from "@nestjs/common";
import { AdminController } from "./admin/admin.controller.js";
import { AuthController } from "./auth/auth.controller.js";
import { DevicesController } from "./devices/devices.controller.js";
import { IrrigationScheduleRunner } from "./domain/irrigation-schedule.runner.js";
import { MqttBridgeService } from "./mqtt/mqtt.service.js";
import { PrismaPersistenceService } from "./persistence/prisma-persistence.service.js";
import { RealtimeGateway } from "./realtime/realtime.gateway.js";

@Module({
  controllers: [AdminController, AuthController, DevicesController],
  providers: [MqttBridgeService, RealtimeGateway, IrrigationScheduleRunner, PrismaPersistenceService]
})
export class AppModule {}
