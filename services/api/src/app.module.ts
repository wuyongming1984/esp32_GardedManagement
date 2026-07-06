import { Module } from "@nestjs/common";
import { AdminController } from "./admin/admin.controller.js";
import { AuthController } from "./auth/auth.controller.js";
import { DevicesController } from "./devices/devices.controller.js";
import { MqttBridgeService } from "./mqtt/mqtt.service.js";
import { RealtimeGateway } from "./realtime/realtime.gateway.js";

@Module({
  controllers: [AdminController, AuthController, DevicesController],
  providers: [MqttBridgeService, RealtimeGateway]
})
export class AppModule {}
