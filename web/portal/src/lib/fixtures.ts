import { PortalState } from "./types";

const devices = [
  {
    id: "device-north-01",
    displayName: "北区温室 P4",
    location: "北区温室 A 号苗床",
    status: "online" as const,
    irrigationState: "off" as const,
    lastSeenLabel: "等待后台刷新",
    mjpegStreamUrl: "http://192.168.110.184:8080/stream.mjpg",
    videoMode: "mjpeg" as const
  },
  {
    id: "device-south-01",
    displayName: "南区育苗台",
    location: "南区育苗台",
    status: "offline" as const,
    irrigationState: "off" as const,
    lastSeenLabel: "等待后台刷新",
    videoMode: "webrtc" as const
  }
];

export const adminFixture: PortalState = {
  user: {
    id: "user-admin",
    name: "平台管理员",
    role: "platform_admin"
  },
  devices,
  audit: [
    { id: "audit-1", label: "页面已启动，等待连接本机后台", time: "刚刚" },
    { id: "audit-2", label: "设备上线事件将通过 MQTT 同步", time: "刚刚" }
  ]
};

export const customerFixture: PortalState = {
  user: {
    id: "user-customer-north",
    name: "北区客户",
    role: "customer"
  },
  devices: [devices[0]],
  audit: [{ id: "audit-1", label: "客户视图已加载", time: "刚刚" }]
};
