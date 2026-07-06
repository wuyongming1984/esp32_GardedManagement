import { Body, Controller, Get, Headers, Param, Post, UnauthorizedException } from "@nestjs/common";
import { appState } from "../app-state.js";
import { actorFromAuthorizationHeader } from "../auth/auth.controller.js";

function requireAdmin(authorization?: string) {
  const user = appState.store.users.get(actorFromAuthorizationHeader(authorization));
  if (!user || user.role !== "platform_admin") {
    throw new UnauthorizedException("Platform admin role required");
  }
}

@Controller("admin")
export class AdminController {
  @Get("customers")
  customers(@Headers("authorization") authorization?: string) {
    requireAdmin(authorization);
    return Array.from(appState.store.customers.values());
  }

  @Post("customers")
  createCustomer(
    @Body() body: { id: string; name: string; contactEmail: string },
    @Headers("authorization") authorization?: string
  ) {
    requireAdmin(authorization);
    appState.store.customers.set(body.id, body);
    return body;
  }

  @Get("devices")
  devices(@Headers("authorization") authorization?: string) {
    requireAdmin(authorization);
    return Array.from(appState.store.devices.values());
  }

  @Post("device-assignments")
  assign(
    @Body() body: { customerId: string; deviceId: string },
    @Headers("authorization") authorization?: string
  ) {
    requireAdmin(authorization);
    const assignment = {
      id: `assignment-${body.customerId}-${body.deviceId}`,
      customerId: body.customerId,
      deviceId: body.deviceId
    };
    appState.store.assignments.set(assignment.id, assignment);
    return assignment;
  }

  @Get("device-assignments/:customerId")
  assignments(@Param("customerId") customerId: string, @Headers("authorization") authorization?: string) {
    requireAdmin(authorization);
    return Array.from(appState.store.assignments.values()).filter(
      (assignment) => assignment.customerId === customerId
    );
  }
}
