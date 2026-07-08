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
  customerId?: string;
  customerName?: string;
  nextScheduleLabel?: string;
}

export interface PortalDeviceLayout {
  id: string;
  title: string;
  subtitle?: string;
  deviceId?: string;
  xPct: number;
  yPct: number;
  widthPct: number;
  heightPct: number;
  zIndex: number;
  updatedAt?: string;
}

export interface AuditItem {
  id: string;
  label: string;
  time: string;
}

export interface PortalState {
  user: PortalUser;
  devices: PortalDevice[];
  deviceLayouts?: PortalDeviceLayout[];
  audit: AuditItem[];
}
