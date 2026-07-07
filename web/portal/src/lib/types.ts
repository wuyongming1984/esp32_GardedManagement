export type UserRole = "platform_admin" | "customer";
export type DeviceStatus = "online" | "offline" | "fault";
export type IrrigationState = "on" | "off";

export interface PortalUser {
  id: string;
  email?: string;
  name: string;
  role: UserRole;
  customerId?: string;
}

export interface PortalDevice {
  id: string;
  displayName: string;
  location: string;
  status: DeviceStatus;
  irrigationState: IrrigationState;
  irrigationRemainingSec?: number;
  lastSeenAt?: string;
  lastSeenLabel: string;
  mjpegStreamUrl?: string;
  videoMode: "webrtc" | "mjpeg";
}

export interface AuditItem {
  id: string;
  label: string;
  time: string;
}

export interface PortalState {
  user: PortalUser;
  devices: PortalDevice[];
  audit: AuditItem[];
}
