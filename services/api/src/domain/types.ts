export type UserRole = "platform_admin" | "customer";
export type DeviceStatus = "offline" | "online" | "fault";
export type IrrigationState = "off" | "on";
export type IrrigationCommandStatus =
  | "queued"
  | "acked"
  | "running"
  | "completed"
  | "failed"
  | "timed_out";
export type VideoMode = "webrtc" | "mjpeg";
export type ActorScope = "user" | "share";
export type IrrigationScheduleType = "one_time" | "daily";

export interface User {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  role: UserRole;
  customerId?: string;
}

export interface Customer {
  id: string;
  name: string;
  contactEmail: string;
}

export interface Device {
  id: string;
  displayName: string;
  location: string;
  status: DeviceStatus;
  irrigationState: IrrigationState;
  irrigationRemainingSec?: number;
  lastSeenAt?: Date;
  mjpegStreamUrl?: string;
  mqttStatusTopic: string;
  mqttEventsTopic: string;
}

export interface DeviceAssignment {
  id: string;
  customerId: string;
  deviceId: string;
}

export interface IrrigationCommand {
  id: string;
  actorUserId: string;
  deviceId: string;
  durationSec: number;
  status: IrrigationCommandStatus;
  requestedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  failureReason?: string;
  commandTopic: string;
}

export interface CustomerShareLink {
  id: string;
  customerId: string;
  deviceId: string;
  tokenHash: string;
  createdByUserId: string;
  createdAt: Date;
  expiresAt: Date;
  revokedAt?: Date;
}

export interface IrrigationSchedule {
  id: string;
  actorUserId: string;
  deviceId: string;
  type: IrrigationScheduleType;
  durationSec: number;
  timezone: "Asia/Shanghai";
  runAt?: Date;
  timeOfDay?: string;
  nextRunAt: Date;
  enabled: boolean;
  lastRunAt?: Date;
  failureReason?: string;
  createdAt: Date;
}

export interface VideoSession {
  id: string;
  actorUserId: string;
  deviceId: string;
  mode: VideoMode;
  createdAt: Date;
  signalingTopic: string;
  mjpegUrl?: string;
}

export interface MjpegFrame {
  data: Buffer;
  contentType: "image/jpeg";
  updatedAt: Date;
}

export interface AuditLog {
  id: string;
  actorUserId: string;
  action: string;
  deviceId?: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface NurseryStore {
  users: Map<string, User>;
  customers: Map<string, Customer>;
  devices: Map<string, Device>;
  assignments: Map<string, DeviceAssignment>;
  irrigationCommands: Map<string, IrrigationCommand>;
  irrigationSchedules: Map<string, IrrigationSchedule>;
  videoSessions: Map<string, VideoSession>;
  shareLinks: Map<string, CustomerShareLink>;
  latestMjpegFrames: Map<string, MjpegFrame>;
  auditLogs: AuditLog[];
}

export interface ActorDeviceRequest {
  actorUserId: string;
  deviceId: string;
}
