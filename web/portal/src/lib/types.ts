export type UserRole = "platform_admin" | "customer";
export type DeviceStatus = "online" | "offline" | "fault";
export type IrrigationState = "on" | "off";

export interface PortalUser {
  id: string;
  name: string;
  role: UserRole;
}

export interface PortalDevice {
  id: string;
  displayName: string;
  location: string;
  status: DeviceStatus;
  irrigationState: IrrigationState;
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
