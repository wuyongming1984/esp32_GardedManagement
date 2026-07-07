import { Body, Controller, Get, Headers, Param, Patch, Post, Query, UnauthorizedException } from "@nestjs/common";
import { appState } from "../app-state.js";
import { actorFromAuthorizationHeader } from "../auth/auth.controller.js";
import { DeviceStatus } from "../domain/types.js";

function requireAdmin(authorization?: string) {
  const userId = actorFromAuthorizationHeader(authorization);
  const user = appState.store.users.get(userId);
  if (!user || user.role !== "platform_admin") {
    throw new UnauthorizedException("Platform admin role required");
  }
  return userId;
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
  devices(
    @Headers("authorization") authorization?: string,
    @Query() query: { search?: string; status?: DeviceStatus; customerId?: string; page?: string; pageSize?: string } = {}
  ) {
    requireAdmin(authorization);
    const search = query.search?.trim().toLowerCase() ?? "";
    const page = Math.max(1, Number(query.page ?? 1) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize ?? 20) || 20));
    const assignedDeviceIds = query.customerId
      ? new Set(
          Array.from(appState.store.assignments.values())
            .filter((assignment) => assignment.customerId === query.customerId)
            .map((assignment) => assignment.deviceId)
        )
      : undefined;

    const filtered = Array.from(appState.store.devices.values()).filter((device) => {
      const matchesSearch =
        search.length === 0 ||
        device.id.toLowerCase().includes(search) ||
        device.displayName.toLowerCase().includes(search) ||
        device.location.toLowerCase().includes(search);
      const matchesStatus = !query.status || device.status === query.status;
      const matchesCustomer = !assignedDeviceIds || assignedDeviceIds.has(device.id);
      return matchesSearch && matchesStatus && matchesCustomer;
    });
    const start = (page - 1) * pageSize;
    return {
      items: filtered.slice(start, start + pageSize),
      total: filtered.length,
      page,
      pageSize
    };
  }

  @Post("devices")
  createDevice(
    @Body() body: { id: string; displayName: string; location: string; customerId?: string },
    @Headers("authorization") authorization?: string
  ) {
    requireAdmin(authorization);
    const device = {
      id: body.id,
      displayName: body.displayName,
      location: body.location,
      status: "offline" as const,
      irrigationState: "off" as const,
      mqttStatusTopic: `devices/${body.id}/status`,
      mqttEventsTopic: `devices/${body.id}/events`
    };
    appState.store.devices.set(device.id, device);
    if (body.customerId) {
      this.assign({ customerId: body.customerId, deviceId: device.id }, authorization);
    }
    return device;
  }

  @Patch("devices/:id")
  updateDevice(
    @Param("id") id: string,
    @Body() body: { displayName?: string; location?: string; customerId?: string },
    @Headers("authorization") authorization?: string
  ) {
    requireAdmin(authorization);
    const device = appState.store.devices.get(id);
    if (!device) {
      throw new UnauthorizedException("Device not found");
    }
    if (body.displayName?.trim()) {
      device.displayName = body.displayName.trim();
    }
    if (body.location?.trim()) {
      device.location = body.location.trim();
    }
    if (body.customerId) {
      this.assign({ customerId: body.customerId, deviceId: id }, authorization);
    }
    return device;
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

  @Get("share-links")
  shareLinks(@Headers("authorization") authorization?: string) {
    return appState.shareLinks.list(requireAdmin(authorization));
  }

  @Post("share-links")
  createShareLink(
    @Body() body: { customerId: string },
    @Headers("authorization") authorization?: string
  ) {
    return appState.shareLinks.create({
      actorUserId: requireAdmin(authorization),
      customerId: body.customerId
    });
  }

  @Post("share-links/:id/revoke")
  revokeShareLink(@Param("id") id: string, @Headers("authorization") authorization?: string) {
    return appState.shareLinks.revoke(requireAdmin(authorization), id);
  }
}
