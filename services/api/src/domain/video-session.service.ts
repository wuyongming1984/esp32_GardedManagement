import { AccessControl } from "./access-control.js";
import { AuditService } from "./audit.service.js";
import { createDomainId } from "./id.js";
import { NurseryStore, VideoMode, VideoSession } from "./types.js";

export interface OpenVideoSessionRequest {
  actorUserId: string;
  deviceId: string;
  preferredMode?: VideoMode;
}

export class VideoSessionService {
  private readonly access: AccessControl;
  private readonly audit: AuditService;

  constructor(private readonly store: NurseryStore) {
    this.access = new AccessControl(store);
    this.audit = new AuditService(store);
  }

  open(input: OpenVideoSessionRequest): VideoSession {
    this.access.assertCanUseDevice(input.actorUserId, input.deviceId);
    const device = this.access.requireDevice(input.deviceId);
    const mode = input.preferredMode ?? "webrtc";
    const id = createDomainId("video");
    const session: VideoSession = {
      id,
      actorUserId: input.actorUserId,
      deviceId: input.deviceId,
      mode,
      createdAt: new Date(),
      signalingTopic: `devices/${input.deviceId}/video/signaling/${id}`,
      mjpegUrl: mode === "mjpeg" ? device.mjpegStreamUrl ?? `/api/devices/${input.deviceId}/mjpeg/${id}` : undefined
    };
    this.store.videoSessions.set(id, session);
    this.audit.record({
      actorUserId: input.actorUserId,
      action: "video.opened",
      deviceId: input.deviceId,
      metadata: { sessionId: id, mode }
    });
    return session;
  }

  close(actorUserId: string, sessionId: string): VideoSession {
    const session = this.store.videoSessions.get(sessionId);
    if (!session) {
      throw new Error("Video session not found");
    }
    this.access.assertCanUseDevice(actorUserId, session.deviceId);
    this.store.videoSessions.delete(sessionId);
    this.audit.record({
      actorUserId,
      action: "video.closed",
      deviceId: session.deviceId,
      metadata: { sessionId }
    });
    return session;
  }
}
