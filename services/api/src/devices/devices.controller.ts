import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  NotFoundException,
  Param,
  Post,
  Query,
  StreamableFile
} from "@nestjs/common";
import { appState } from "../app-state.js";
import { actorFromAuthorizationHeader } from "../auth/auth.controller.js";

function mapDomainError(error: unknown): never {
  if (error instanceof Error) {
    if (error.message === "Device is not assigned to this customer") {
      throw new ForbiddenException(error.message);
    }
    if (error.message.includes("not found")) {
      throw new NotFoundException(error.message);
    }
    if (error.message.includes("durationSec")) {
      throw new BadRequestException(error.message);
    }
  }
  throw error;
}

@Controller()
export class DevicesController {
  @Get("devices")
  list(@Headers("authorization") authorization?: string) {
    return appState.devices.listForUser(actorFromAuthorizationHeader(authorization));
  }

  @Get("devices/:id")
  get(@Param("id") id: string, @Headers("authorization") authorization?: string) {
    try {
      return appState.devices.getForUser(actorFromAuthorizationHeader(authorization), id);
    } catch (error) {
      mapDomainError(error);
    }
  }

  @Post("devices/:id/video-sessions")
  openVideo(
    @Param("id") id: string,
    @Body() body: { preferredMode?: "webrtc" | "mjpeg" },
    @Headers("authorization") authorization?: string
  ) {
    try {
      return appState.video.open({
        actorUserId: actorFromAuthorizationHeader(authorization),
        deviceId: id,
        preferredMode: body.preferredMode
      });
    } catch (error) {
      mapDomainError(error);
    }
  }

  @Delete("video-sessions/:id")
  closeVideo(@Param("id") id: string, @Headers("authorization") authorization?: string) {
    try {
      return appState.video.close(actorFromAuthorizationHeader(authorization), id);
    } catch (error) {
      mapDomainError(error);
    }
  }

  @Get("devices/:id/mjpeg/latest.jpg")
  getLatestMjpegFrame(
    @Param("id") id: string,
    @Headers("authorization") authorization?: string,
    @Query("token") token?: string
  ) {
    try {
      const effectiveAuthorization = authorization ?? (token ? `Bearer ${token}` : undefined);
      appState.devices.getForUser(actorFromAuthorizationHeader(effectiveAuthorization), id);
      const frame = appState.store.latestMjpegFrames.get(id);
      if (!frame) {
        throw new NotFoundException("Latest MJPEG frame not found");
      }
      return new StreamableFile(frame.data, {
        type: frame.contentType,
        disposition: `inline; filename="${id}-latest.jpg"`
      });
    } catch (error) {
      mapDomainError(error);
    }
  }

  @Post("devices/:id/irrigation-commands")
  irrigate(
    @Param("id") id: string,
    @Body() body: { durationSec: number },
    @Headers("authorization") authorization?: string
  ) {
    try {
      return appState.irrigation.request({
        actorUserId: actorFromAuthorizationHeader(authorization),
        deviceId: id,
        durationSec: body.durationSec
      });
    } catch (error) {
      mapDomainError(error);
    }
  }
}
