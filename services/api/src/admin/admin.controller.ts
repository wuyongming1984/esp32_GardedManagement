import { BadRequestException, Body, Controller, Get, Headers, Param, Patch, Post, Put, Query, UnauthorizedException } from "@nestjs/common";
import { appState } from "../app-state.js";
import { actorFromAuthorizationHeader } from "../auth/auth.controller.js";
import { Device, DeviceStatus, PlotCard } from "../domain/types.js";

function requireAdmin(authorization?: string) {
  const userId = actorFromAuthorizationHeader(authorization);
  const user = appState.store.users.get(userId);
  if (!user || user.role !== "platform_admin") {
    throw new UnauthorizedException("Platform admin role required");
  }
  return userId;
}

function withAssignmentDetails(device: Device) {
  const assignment = Array.from(appState.store.assignments.values()).find((candidate) => candidate.deviceId === device.id);
  const customer = assignment ? appState.store.customers.get(assignment.customerId) : undefined;
  return {
    ...device,
    customerId: assignment?.customerId,
    customerName: customer?.name
  };
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

function sanitizePlotCard(input: Partial<PlotCard>, index: number): PlotCard {
  const id = input.id?.trim();
  if (!id) {
    throw new BadRequestException("Plot card id is required");
  }
  const deviceId = input.deviceId?.trim() || undefined;
  if (deviceId && !appState.store.devices.has(deviceId)) {
    throw new BadRequestException("Plot card deviceId is invalid");
  }
  const device = deviceId ? appState.store.devices.get(deviceId) : undefined;
  return {
    id,
    deviceId,
    title: input.title?.trim() || device?.location || device?.displayName || `未命名地块 ${index + 1}`,
    xPct: clampNumber(input.xPct, 0, 94, 6 + (index % 3) * 30),
    yPct: clampNumber(input.yPct, 0, 94, 10 + Math.floor(index / 3) * 28),
    widthPct: clampNumber(input.widthPct, 12, 80, 24),
    heightPct: clampNumber(input.heightPct, 12, 80, 20),
    zIndex: Math.round(clampNumber(input.zIndex, 1, 9999, index + 1)),
    updatedAt: new Date()
  };
}

function listDeviceLayouts() {
  return Array.from(appState.store.plotCards.values()).sort((a, b) => a.zIndex - b.zIndex);
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
      items: filtered.slice(start, start + pageSize).map(withAssignmentDetails),
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

  @Get("device-layouts")
  deviceLayouts(@Headers("authorization") authorization?: string) {
    requireAdmin(authorization);
    return { items: listDeviceLayouts() };
  }

  @Put("device-layouts")
  saveDeviceLayouts(
    @Body() body: { items?: Array<Partial<PlotCard>> },
    @Headers("authorization") authorization?: string
  ) {
    requireAdmin(authorization);
    const items = body.items ?? [];
    const seenIds = new Set<string>();
    const seenDeviceIds = new Set<string>();
    for (const item of items) {
      const id = item.id?.trim();
      if (id && seenIds.has(id)) {
        throw new BadRequestException("Plot card id must be unique");
      }
      if (id) {
        seenIds.add(id);
      }
      const deviceId = item.deviceId?.trim();
      if (deviceId && seenDeviceIds.has(deviceId)) {
        throw new BadRequestException("Plot card deviceId must be unique");
      }
      if (deviceId) {
        seenDeviceIds.add(deviceId);
      }
    }
    const saved = items.map((item, index) => sanitizePlotCard(item, index));
    appState.store.plotCards = new Map(saved.map((layout) => [layout.id, layout]));
    return { items: saved };
  }

  @Get("share-links")
  shareLinks(@Headers("authorization") authorization?: string) {
    return appState.shareLinks.list(requireAdmin(authorization));
  }

  @Post("share-links")
  createShareLink(@Body() body: { customerId: string; deviceId: string }, @Headers("authorization") authorization?: string) {
    return appState.shareLinks.create({
      actorUserId: requireAdmin(authorization),
      customerId: body.customerId,
      deviceId: body.deviceId
    });
  }

  @Post("share-links/:id/revoke")
  revokeShareLink(@Param("id") id: string, @Headers("authorization") authorization?: string) {
    return appState.shareLinks.revoke(requireAdmin(authorization), id);
  }
}
