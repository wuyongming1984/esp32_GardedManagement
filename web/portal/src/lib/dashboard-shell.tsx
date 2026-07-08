"use client";

import {
  CalendarClock,
  Camera,
  Copy,
  Droplets,
  Leaf,
  Link as LinkIcon,
  LogIn,
  Maximize2,
  Move,
  Plus,
  RefreshCw,
  Save,
  Search,
  Shield,
  Trash2,
  Wifi,
  WifiOff
} from "lucide-react";
import { type ChangeEvent, type FormEvent, type PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PortalDevice, PortalDeviceLayout, PortalState, PortalUser } from "./types";

interface DashboardShellProps {
  initialState: PortalState;
  initialToken?: string;
  initialShareToken?: string;
  autoRefresh?: boolean;
}

interface ApiDevice extends Partial<PortalDevice> {
  id: string;
  displayName: string;
  location: string;
  status: PortalDevice["status"];
  irrigationState: PortalDevice["irrigationState"];
  irrigationRemainingSec?: number;
  lastSeenAt?: string;
  mjpegStreamUrl?: string;
  customerId?: string;
}

interface ApiLoginResponse {
  accessToken: string;
  user: PortalUser;
}

interface ApiVideoSession {
  id: string;
  mode: PortalDevice["videoMode"];
  mjpegUrl?: string;
}

type ActiveView = "devices" | "schedules" | "links" | "account" | "audit";
type DeviceStatusFilter = "all" | "online" | "offline";
type LayoutSaveState = "idle" | "saving" | "saved" | "error";

interface ApiDeviceLayout extends PortalDeviceLayout {
  updatedAt?: string;
}

interface LayoutDragState {
  deviceId: string;
  mode: "move" | "resize";
  startX: number;
  startY: number;
  canvasWidth: number;
  canvasHeight: number;
  layout: PortalDeviceLayout;
}

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api";
const DEFAULT_LOGIN_EMAIL = process.env.NEXT_PUBLIC_DEMO_ADMIN_EMAIL ?? "admin@nursery.local";
const DEFAULT_LOGIN_PASSWORD = "change-me-now";

function apiUrl(path: string) {
  if (API_BASE === "/api") {
    if (path.startsWith("/auth/") || path === "/me" || path.startsWith("/me/")) {
      return path;
    }
    return path.startsWith("/api/") ? path : `/api${path}`;
  }
  return `${API_BASE}${path}`;
}

export function resolvePreviewUrl(value?: string | null, token?: string | null) {
  if (!value) {
    return null;
  }
  if (value.startsWith("/")) {
    const separator = value.includes("?") ? "&" : "?";
    const tokenQuery = token ? `${separator}token=${encodeURIComponent(token)}` : "";
    return `${API_BASE === "/api" ? "" : API_BASE}${value}${tokenQuery}`;
  }
  return value;
}

export function appendPreviewFrameParam(value: string | null, frameSeq: number) {
  if (!value) {
    return null;
  }
  const separator = value.includes("?") ? "&" : "?";
  return `${value}${separator}frame=${frameSeq}`;
}

function statusLabel(status: PortalDevice["status"]) {
  if (status === "online") return "在线";
  if (status === "fault") return "故障";
  return "离线";
}

function irrigationStateLabel(state: PortalDevice["irrigationState"]) {
  return state === "on" ? "浇灌中" : "已停止";
}

function formatLastSeen(value?: string) {
  if (!value) {
    return "暂无上线记录";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}

function mapApiDevice(device: ApiDevice): PortalDevice {
  return {
    id: device.id,
    displayName: device.displayName,
    location: device.location,
    status: device.status,
    irrigationState: device.irrigationState,
    irrigationRemainingSec: device.irrigationRemainingSec,
    lastSeenAt: device.lastSeenAt,
    lastSeenLabel: device.lastSeenLabel ?? formatLastSeen(device.lastSeenAt),
    mjpegStreamUrl: device.mjpegStreamUrl,
    videoMode: device.videoMode ?? "mjpeg",
    customerId: device.customerId,
    customerName: device.customerName,
    nextScheduleLabel: device.nextScheduleLabel
  };
}

function asDevicePage(payload: unknown): { items: ApiDevice[]; total: number; page: number; pageSize: number } {
  if (Array.isArray(payload)) {
    return { items: payload as ApiDevice[], total: payload.length, page: 1, pageSize: payload.length || 20 };
  }
  const page = payload as { items?: ApiDevice[]; total?: number; page?: number; pageSize?: number };
  return {
    items: page.items ?? [],
    total: page.total ?? page.items?.length ?? 0,
    page: page.page ?? 1,
    pageSize: page.pageSize ?? 20
  };
}

function clampPercent(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function defaultDeviceLayout(device: PortalDevice, index: number): PortalDeviceLayout {
  const column = index % 3;
  const row = Math.floor(index / 3);
  return {
    deviceId: device.id,
    title: device.location || device.displayName,
    xPct: 6 + column * 30,
    yPct: 10 + row * 28,
    widthPct: 24,
    heightPct: 20,
    zIndex: index + 1
  };
}

function normalizeDeviceLayouts(devices: PortalDevice[], layouts: PortalDeviceLayout[] = []) {
  const deviceIds = new Set(devices.map((device) => device.id));
  const seenDeviceIds = new Set<string>();
  return layouts.filter((layout) => {
    if (!deviceIds.has(layout.deviceId) || seenDeviceIds.has(layout.deviceId)) {
      return false;
    }
    seenDeviceIds.add(layout.deviceId);
    return true;
  });
}

function saveStateLabel(value: LayoutSaveState) {
  if (value === "saving") return "保存中";
  if (value === "saved") return "已自动保存";
  if (value === "error") return "保存失败";
  return "使用默认布局";
}

export function DashboardShell({ initialState, initialToken, initialShareToken, autoRefresh = true }: DashboardShellProps) {
  const [state, setState] = useState(initialState);
  const [token, setToken] = useState<string | null>(initialToken ?? null);
  const [shareMode, setShareMode] = useState(false);
  const [activeView, setActiveView] = useState<ActiveView>("devices");
  const [statusFilter, setStatusFilter] = useState<DeviceStatusFilter>("all");
  const [editLayout, setEditLayout] = useState(false);
  const [layoutSaveState, setLayoutSaveState] = useState<LayoutSaveState>("idle");
  const [deviceLayouts, setDeviceLayouts] = useState<PortalDeviceLayout[]>(
    normalizeDeviceLayouts(initialState.devices, initialState.deviceLayouts)
  );
  const [dragState, setDragState] = useState<LayoutDragState | null>(null);
  const [statusMessage, setStatusMessage] = useState(initialToken ? "已登录，正在读取设备状态..." : "请先登录后台");
  const [loginEmail, setLoginEmail] = useState(DEFAULT_LOGIN_EMAIL);
  const [loginPassword, setLoginPassword] = useState(DEFAULT_LOGIN_PASSWORD);
  const [loginMessage, setLoginMessage] = useState("请输入平台管理员或客户账号邮箱和密码");
  const [loginBusy, setLoginBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedDeviceId, setSelectedDeviceId] = useState(initialState.devices[0]?.id ?? "");
  const [addDeviceId, setAddDeviceId] = useState("");
  const [totalDevices, setTotalDevices] = useState(initialState.devices.length);
  const [shareUrl, setShareUrl] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [scheduleMessages, setScheduleMessages] = useState<string[]>([]);
  const [oneTimeRunAt, setOneTimeRunAt] = useState("2026-07-08T09:30");
  const [oneTimeDuration, setOneTimeDuration] = useState(60);
  const [dailyTime, setDailyTime] = useState("08:00");
  const [dailyDuration, setDailyDuration] = useState(300);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewFrameSeq, setPreviewFrameSeq] = useState(0);
  const [accountName, setAccountName] = useState(initialState.user.name);
  const [accountEmail, setAccountEmail] = useState(initialState.user.email ?? "");
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const deviceLayoutsRef = useRef(deviceLayouts);
  const isAdmin = state.user.role === "platform_admin" && !shareMode;
  const selectedDevice = state.devices.find((device) => device.id === selectedDeviceId) ?? state.devices[0];

  const filteredDevices = useMemo(() => {
    const value = search.trim().toLowerCase();
    return state.devices.filter((device) =>
      (statusFilter === "all" || device.status === statusFilter) &&
      (!value || [device.id, device.displayName, device.location].some((field) => field.toLowerCase().includes(value)))
    );
  }, [search, state.devices, statusFilter]);

  const onlineCount = useMemo(() => state.devices.filter((device) => device.status === "online").length, [state.devices]);
  const previewImageUrl = appendPreviewFrameParam(previewUrl, previewFrameSeq);
  const layoutByDeviceId = useMemo(() => new Map(deviceLayouts.map((layout) => [layout.deviceId, layout])), [deviceLayouts]);
  const devicesById = useMemo(() => new Map(state.devices.map((device) => [device.id, device])), [state.devices]);
  const visibleFieldCards = useMemo(
    () =>
      deviceLayouts
        .map((layout) => ({ layout, device: devicesById.get(layout.deviceId) }))
        .filter((item): item is { layout: PortalDeviceLayout; device: PortalDevice } =>
          Boolean(item.device && filteredDevices.some((device) => device.id === item.layout.deviceId))
        )
        .sort((a, b) => a.layout.zIndex - b.layout.zIndex),
    [deviceLayouts, devicesById, filteredDevices]
  );
  const unplacedDevices = useMemo(
    () => state.devices.filter((device) => !layoutByDeviceId.has(device.id)),
    [layoutByDeviceId, state.devices]
  );
  const selectedLayout = selectedDevice ? layoutByDeviceId.get(selectedDevice.id) : undefined;
  const rebindableDevices = useMemo(
    () => state.devices.filter((device) => device.id === selectedDevice?.id || !layoutByDeviceId.has(device.id)),
    [layoutByDeviceId, selectedDevice?.id, state.devices]
  );

  const replaceDeviceLayouts = useCallback((next: PortalDeviceLayout[]) => {
    deviceLayoutsRef.current = next;
    setDeviceLayouts(next);
  }, []);

  const persistLayouts = useCallback(
    async (layouts: PortalDeviceLayout[]) => {
      if (!token || !isAdmin) return;
      setLayoutSaveState("saving");
      try {
        const response = await fetch(apiUrl("/api/admin/device-layouts"), {
          method: "PUT",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ items: layouts })
        });
        if (!response.ok) {
          throw new Error(`布局保存失败：${response.status}`);
        }
        const body = (await response.json()) as { items?: ApiDeviceLayout[] };
        if (body.items) {
          replaceDeviceLayouts(normalizeDeviceLayouts(state.devices, body.items));
        }
        setLayoutSaveState("saved");
      } catch {
        setLayoutSaveState("error");
      }
    },
    [isAdmin, replaceDeviceLayouts, state.devices, token]
  );

  const refreshLayouts = useCallback(async () => {
    if (!token || !isAdmin) return;
    try {
      const response = await fetch(apiUrl("/api/admin/device-layouts"), {
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store"
      });
      if (!response.ok) {
        throw new Error(`布局读取失败：${response.status}`);
      }
      const body = (await response.json()) as { items?: ApiDeviceLayout[] };
      replaceDeviceLayouts(normalizeDeviceLayouts(state.devices, body.items ?? []));
      setLayoutSaveState("saved");
    } catch {
      replaceDeviceLayouts(normalizeDeviceLayouts(state.devices, deviceLayoutsRef.current));
    }
  }, [isAdmin, replaceDeviceLayouts, state.devices, token]);

  const updateSingleLayout = useCallback((deviceId: string, updater: (layout: PortalDeviceLayout) => PortalDeviceLayout) => {
    const current = normalizeDeviceLayouts(state.devices, deviceLayoutsRef.current);
    const next = current.map((layout) => (layout.deviceId === deviceId ? updater(layout) : layout));
    replaceDeviceLayouts(next);
    return next;
  }, [replaceDeviceLayouts, state.devices]);

  const rebindSelectedLayout = useCallback((event: ChangeEvent<HTMLSelectElement>) => {
    const nextDeviceId = event.target.value;
    if (!isAdmin || !selectedDeviceId || nextDeviceId === selectedDeviceId) return;

    const current = normalizeDeviceLayouts(state.devices, deviceLayoutsRef.current);
    const selectedLayout = current.find((layout) => layout.deviceId === selectedDeviceId);
    const nextDevice = state.devices.find((device) => device.id === nextDeviceId);
    if (!selectedLayout || !nextDevice || current.some((layout) => layout.deviceId === nextDeviceId)) return;

    const next = current
      .map((layout) =>
        layout.deviceId === selectedDeviceId
          ? { ...layout, deviceId: nextDeviceId, title: nextDevice.location || nextDevice.displayName }
          : layout
      );
    replaceDeviceLayouts(next);
    setSelectedDeviceId(nextDeviceId);
    void persistLayouts(next);
  }, [isAdmin, persistLayouts, replaceDeviceLayouts, selectedDeviceId, state.devices]);

  const canvasMetrics = useCallback(() => {
    const rect = canvasRef.current?.getBoundingClientRect();
    return {
      width: rect?.width && rect.width > 0 ? rect.width : 1000,
      height: rect?.height && rect.height > 0 ? rect.height : 520
    };
  }, []);

  const beginLayoutDrag = useCallback(
    (event: ReactPointerEvent<HTMLElement>, deviceId: string, mode: "move" | "resize") => {
      setSelectedDeviceId(deviceId);
      if (!editLayout || !isAdmin) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const current = normalizeDeviceLayouts(state.devices, deviceLayoutsRef.current);
      const layout = current.find((item) => item.deviceId === deviceId);
      if (!layout) {
        return;
      }
      const maxZ = Math.max(...current.map((item) => item.zIndex), 0);
      const next = updateSingleLayout(deviceId, (item) => ({ ...item, zIndex: maxZ + 1 }));
      const activeLayout = next.find((item) => item.deviceId === deviceId) ?? layout;
      const metrics = canvasMetrics();
      setDragState({
        deviceId,
        mode,
        startX: event.clientX,
        startY: event.clientY,
        canvasWidth: metrics.width,
        canvasHeight: metrics.height,
        layout: activeLayout
      });
    },
    [canvasMetrics, editLayout, isAdmin, state.devices, updateSingleLayout]
  );

  const refreshDevices = useCallback(async () => {
    if (!token) return;
    const path = isAdmin ? `/api/admin/devices?search=${encodeURIComponent(search)}&page=1&pageSize=100` : "/api/devices";
    const response = await fetch(apiUrl(path), {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store"
    });
    if (!response.ok) {
      throw new Error(`设备列表读取失败：${response.status}`);
    }
    const page = asDevicePage(await response.json());
    setState((current) => ({
      ...current,
      devices: page.items.map(mapApiDevice),
      audit: [
        { id: `live-${Date.now()}`, label: "已从后台刷新设备状态", time: new Date().toLocaleTimeString("zh-CN") },
        ...current.audit.slice(0, 4)
      ]
    }));
    setTotalDevices(page.total);
    if (page.items[0] && !page.items.some((device) => device.id === selectedDeviceId)) {
      setSelectedDeviceId(page.items[0].id);
    }
    setStatusMessage(shareMode ? "客户链接管理模式：仅可管理此设备" : "已连接后台，设备状态为实时数据");
  }, [isAdmin, search, selectedDeviceId, shareMode, token]);

  useEffect(() => {
    deviceLayoutsRef.current = deviceLayouts;
  }, [deviceLayouts]);

  useEffect(() => {
    replaceDeviceLayouts(normalizeDeviceLayouts(state.devices, deviceLayoutsRef.current));
  }, [replaceDeviceLayouts, state.devices]);

  useEffect(() => {
    if (unplacedDevices.length === 0) {
      setAddDeviceId("");
      return;
    }
    if (!unplacedDevices.some((device) => device.id === addDeviceId)) {
      setAddDeviceId(unplacedDevices[0].id);
    }
  }, [addDeviceId, unplacedDevices]);

  useEffect(() => {
    if (!token || !isAdmin) return;
    void refreshLayouts();
  }, [isAdmin, refreshLayouts, token]);

  useEffect(() => {
    if (!dragState) return;
    const activeDrag = dragState;

    function applyPointerMove(event: PointerEvent) {
      const dxPct = ((event.clientX - activeDrag.startX) / activeDrag.canvasWidth) * 100;
      const dyPct = ((event.clientY - activeDrag.startY) / activeDrag.canvasHeight) * 100;
      updateSingleLayout(activeDrag.deviceId, (layout) => {
        if (activeDrag.mode === "resize") {
          const widthPct = clampPercent(activeDrag.layout.widthPct + dxPct, 12, 100 - activeDrag.layout.xPct);
          const heightPct = clampPercent(activeDrag.layout.heightPct + dyPct, 12, 100 - activeDrag.layout.yPct);
          return { ...layout, widthPct, heightPct };
        }
        const xPct = clampPercent(activeDrag.layout.xPct + dxPct, 0, 100 - activeDrag.layout.widthPct);
        const yPct = clampPercent(activeDrag.layout.yPct + dyPct, 0, 100 - activeDrag.layout.heightPct);
        return { ...layout, xPct, yPct };
      });
    }

    function finishPointerDrag() {
      setDragState(null);
      void persistLayouts(deviceLayoutsRef.current);
    }

    window.addEventListener("pointermove", applyPointerMove);
    window.addEventListener("pointerup", finishPointerDrag);
    return () => {
      window.removeEventListener("pointermove", applyPointerMove);
      window.removeEventListener("pointerup", finishPointerDrag);
    };
  }, [dragState, persistLayouts, updateSingleLayout]);

  useEffect(() => {
    if (!initialShareToken) return;
    let cancelled = false;
    async function exchange() {
      try {
        const response = await fetch(apiUrl(`/auth/share-links/${initialShareToken}/exchange`), { method: "POST" });
        if (!response.ok) throw new Error(`客户链接失效：${response.status}`);
        const body = (await response.json()) as ApiLoginResponse;
        if (!cancelled) {
          setShareMode(true);
          setToken(body.accessToken);
          setState((current) => ({ ...current, user: body.user, devices: [] }));
          setStatusMessage("客户链接管理模式：仅可管理此设备");
        }
      } catch (error) {
        if (!cancelled) setLoginMessage(error instanceof Error ? error.message : "客户链接打开失败");
      }
    }
    void exchange();
    return () => {
      cancelled = true;
    };
  }, [initialShareToken]);

  useEffect(() => {
    if (!token || !autoRefresh) return;
    void refreshDevices().catch((error) => setStatusMessage(error instanceof Error ? error.message : "设备刷新失败"));
    const timer = window.setInterval(() => {
      void refreshDevices().catch((error) => setStatusMessage(error instanceof Error ? error.message : "设备刷新失败"));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, refreshDevices, token]);

  useEffect(() => {
    if (!previewOpen) return;
    const timer = window.setInterval(() => setPreviewFrameSeq((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [previewOpen]);

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginBusy(true);
    setLoginMessage("正在登录...");
    try {
      const response = await fetch(apiUrl("/auth/login"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: loginEmail.trim(), password: loginPassword })
      });
      if (!response.ok) throw new Error(response.status === 401 ? "账号或密码错误" : `登录失败：${response.status}`);
      const body = (await response.json()) as ApiLoginResponse;
      setToken(body.accessToken);
      setShareMode(false);
      setState((current) => ({
        ...current,
        user: body.user,
        devices: [],
        audit: [
          { id: `login-${Date.now()}`, label: "登录成功，正在读取设备状态", time: new Date().toLocaleTimeString("zh-CN") },
          ...current.audit.slice(0, 4)
        ]
      }));
      setAccountName(body.user.name);
      setAccountEmail(body.user.email ?? "");
      setLoginMessage("登录成功");
    } catch (error) {
      setLoginMessage(error instanceof Error ? error.message : "登录失败");
    } finally {
      setLoginBusy(false);
    }
  }

  async function openPreview() {
    if (!token || !selectedDevice) return;
    if (previewOpen) {
      setPreviewOpen(false);
      return;
    }
    const response = await fetch(apiUrl(`/api/devices/${selectedDevice.id}/video-sessions`), {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ preferredMode: "mjpeg" })
    });
    const session = response.ok ? ((await response.json()) as ApiVideoSession) : undefined;
    setPreviewUrl(resolvePreviewUrl(session?.mjpegUrl ?? selectedDevice.mjpegStreamUrl, token));
    setPreviewOpen(true);
    setPreviewFrameSeq(0);
  }

  async function createSchedule(type: "one_time" | "daily") {
    if (!token || !selectedDevice) return;
    const body =
      type === "one_time"
        ? { type, runAt: new Date(oneTimeRunAt).toISOString(), durationSec: Number(oneTimeDuration) }
        : { type, timeOfDay: dailyTime, durationSec: Number(dailyDuration) };
    const response = await fetch(apiUrl(`/api/devices/${selectedDevice.id}/irrigation-schedules`), {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      setActionMessage("定时创建失败");
      return;
    }
    const message = type === "one_time" ? "已创建一次预约" : "已创建每日定时";
    setScheduleMessages((current) => [...current.slice(-3), message]);
    setActionMessage(message);
  }

  async function startIrrigation() {
    if (!token || !selectedDevice) return;
    const response = await fetch(apiUrl(`/api/devices/${selectedDevice.id}/irrigation-commands`), {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ durationSec: oneTimeDuration })
    });
    setActionMessage(response.ok ? "限时浇灌已下发" : "浇灌命令下发失败");
    await refreshDevices();
  }

  async function saveAccount() {
    if (!token) return;
    const response = await fetch(apiUrl("/me"), {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ name: accountName, email: accountEmail })
    });
    if (response.ok) {
      const user = (await response.json()) as PortalUser;
      setState((current) => ({ ...current, user }));
      setActionMessage("账号信息已更新");
    } else {
      setActionMessage("账号信息更新失败");
    }
  }

  async function createShareLink() {
    if (!token || !isAdmin || !selectedDevice) return;
    const customerId = selectedDevice.customerId ?? state.user.customerId ?? "customer-north";
    const response = await fetch(apiUrl("/api/admin/share-links"), {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ customerId, deviceId: selectedDevice.id })
    });
    if (response.ok) {
      const body = (await response.json()) as { url: string };
      setShareUrl(body.url);
      setActionMessage("客户链接已生成");
      setActiveView("links");
    } else {
      setActionMessage("客户链接生成失败");
    }
  }

  async function moveSelectedLayer(position: "front" | "back") {
    if (!selectedDevice || !selectedLayout || !isAdmin) return;
    const current = normalizeDeviceLayouts(state.devices, deviceLayoutsRef.current);
    const zValues = current.map((layout) => layout.zIndex);
    const nextZ = position === "front" ? Math.max(...zValues, 0) + 1 : Math.min(...zValues, 1) - 1;
    const next = updateSingleLayout(selectedDevice.id, (layout) => ({ ...layout, zIndex: nextZ }));
    await persistLayouts(next);
  }

  async function addDeviceCard() {
    if (!isAdmin || !addDeviceId) return;
    const device = state.devices.find((item) => item.id === addDeviceId);
    if (!device || layoutByDeviceId.has(device.id)) return;
    const current = normalizeDeviceLayouts(state.devices, deviceLayoutsRef.current);
    const nextLayout = {
      ...defaultDeviceLayout(device, current.length),
      zIndex: Math.max(...current.map((layout) => layout.zIndex), 0) + 1
    };
    const next = [...current, nextLayout];
    replaceDeviceLayouts(next);
    setSelectedDeviceId(device.id);
    await persistLayouts(next);
  }

  async function deleteSelectedLayout() {
    if (!isAdmin || !selectedDevice || !selectedLayout) return;
    if (!window.confirm(`删除 ${selectedDevice.displayName} 的地图卡片？设备本身不会删除。`)) return;
    const next = normalizeDeviceLayouts(state.devices, deviceLayoutsRef.current).filter(
      (layout) => layout.deviceId !== selectedDevice.id
    );
    replaceDeviceLayouts(next);
    await persistLayouts(next);
  }

  async function resetLayouts() {
    if (!isAdmin) return;
    const next = state.devices.map(defaultDeviceLayout);
    replaceDeviceLayouts(next);
    await persistLayouts(next);
  }

  if (!token) {
    return (
      <main className="login-shell">
        <section className="login-panel" aria-label="登录">
          <div className="brand login-brand">
            <div className="brand-mark">
              <Leaf size={22} />
            </div>
            <div>
              <strong>苗圃智能</strong>
              <span>ESP32-P4 设备群</span>
            </div>
          </div>
          <h1>苗圃智能登录</h1>
          <p>请输入平台管理员或客户账号邮箱和密码，登录后管理设备、预览画面和浇灌任务。</p>
          <form className="login-form" onSubmit={submitLogin}>
            <label htmlFor="login-email">登录邮箱</label>
            <input id="login-email" type="email" value={loginEmail} onChange={(event) => setLoginEmail(event.target.value)} />
            <label htmlFor="login-password">登录密码</label>
            <input
              id="login-password"
              type="password"
              value={loginPassword}
              onChange={(event) => setLoginPassword(event.target.value)}
            />
            <button type="submit" className="icon-button primary" disabled={loginBusy}>
              <LogIn size={17} />
              {loginBusy ? "登录中..." : "登录"}
            </button>
          </form>
          <p className="login-hint">默认管理员：admin@nursery.local / change-me-now</p>
          <p className="login-message" role="status">{initialShareToken ? "正在打开客户链接..." : loginMessage}</p>
        </section>
      </main>
    );
  }

  if (shareMode) {
    return (
      <main className="share-device-shell">
        <section className="share-device-main" aria-label="客户单设备管理">
          <header className="share-device-header">
            <div className="brand">
              <div className="brand-mark"><Leaf size={22} /></div>
              <div><strong>苗圃地块管理</strong><span>客户专属链接</span></div>
            </div>
            <div className="user-pill"><Shield size={16} />{state.user.name}</div>
          </header>
          {!selectedDevice ? (
            <section className="panel compact-panel">
              <h1>正在加载设备</h1>
              <p>此链接只会打开管理员指定的开发板。</p>
            </section>
          ) : (
            <section className="single-plot-panel">
              <div className="single-plot-visual">
                <span className={`status ${selectedDevice.status}`}>{statusLabel(selectedDevice.status)}</span>
                <h1>{selectedDevice.displayName}</h1>
                <p>{selectedDevice.id} · {selectedDevice.location}</p>
                <div className="preview-frame share-preview">
                  {previewOpen && previewImageUrl ? <img className="preview-image" src={previewImageUrl} alt={`${selectedDevice.displayName} 实时摄像头画面`} /> : <Camera size={52} />}
                </div>
                <button type="button" className="icon-button" disabled={selectedDevice.status !== "online"} onClick={openPreview}>
                  <Camera size={17} />{previewOpen ? "关闭实时预览" : "打开实时预览"}
                </button>
              </div>
              <div className="single-plot-controls">
                <section className="drawer-section">
                  <h3>浇灌控制</h3>
                  <p>当前状态：{irrigationStateLabel(selectedDevice.irrigationState)}</p>
                  <button type="button" className="icon-button primary" onClick={startIrrigation}><Droplets size={17} />下发限时浇灌</button>
                </section>
                <section className="drawer-section">
                  <h3>一次性浇灌</h3>
                  <label className="full-field"><span>一次预约时间</span><input type="datetime-local" value={oneTimeRunAt} onChange={(event) => setOneTimeRunAt(event.target.value)} /></label>
                  <label className="full-field"><span>一次浇灌秒数</span><input type="number" min={1} max={900} value={oneTimeDuration} onChange={(event) => setOneTimeDuration(Number(event.target.value))} /></label>
                  <button type="button" className="icon-button primary" onClick={() => void createSchedule("one_time")}><CalendarClock size={17} />创建一次预约</button>
                </section>
                <section className="drawer-section">
                  <h3>每日重复定时</h3>
                  <label className="full-field"><span>每日执行时间</span><input type="time" value={dailyTime} onChange={(event) => setDailyTime(event.target.value)} /></label>
                  <label className="full-field"><span>每日浇灌秒数</span><input type="number" min={1} max={900} value={dailyDuration} onChange={(event) => setDailyDuration(Number(event.target.value))} /></label>
                  <button type="button" className="icon-button primary" onClick={() => void createSchedule("daily")}><CalendarClock size={17} />创建每日定时</button>
                </section>
                {actionMessage ? <p className="action-message">{actionMessage}</p> : null}
              </div>
            </section>
          )}
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell management-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Leaf size={22} /></div>
          <div><strong>苗圃智能控制中心</strong><span>ESP32-P4 设备群</span></div>
        </div>
        <nav aria-label="主导航">
          <a className={activeView === "devices" ? "active" : ""} href="#devices" onClick={(e) => { e.preventDefault(); setActiveView("devices"); }}>设备</a>
          <a className={activeView === "schedules" ? "active" : ""} href="#schedules" onClick={(e) => { e.preventDefault(); setActiveView("schedules"); }}>定时浇灌</a>
          {isAdmin ? <a className={activeView === "links" ? "active" : ""} href="#links" onClick={(e) => { e.preventDefault(); setActiveView("links"); }}>客户链接</a> : null}
          {!shareMode ? <a className={activeView === "account" ? "active" : ""} href="#account" onClick={(e) => { e.preventDefault(); setActiveView("account"); }}>账号设置</a> : null}
          <a className={activeView === "audit" ? "active" : ""} href="#audit" onClick={(e) => { e.preventDefault(); setActiveView("audit"); }}>审计</a>
        </nav>
        <div className="sidebar-status">
          <span>系统状态</span><strong>正常</strong>
          <span>API 连接</span><strong>在线</strong>
          <span>MQTT 连接</span><strong>在线</strong>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <h1>苗圃智能控制中心</h1>
            <p>{shareMode ? "客户设备管理视图" : isAdmin ? "平台管理员视图" : "客户设备视图"}</p>
          </div>
          <div className="user-pill"><Shield size={16} />{state.user.name}</div>
        </header>

        <section className="summary-grid" aria-label="系统概览">
          <div><span>设备总数</span><strong>{totalDevices}</strong></div>
          <div><span>在线设备</span><strong>{onlineCount}</strong></div>
          <div><span>安全关闭策略</span><strong>已启用</strong></div>
        </section>

        {activeView === "devices" || activeView === "schedules" ? (
          <section id="devices" className="panel device-management-panel">
            <div className="panel-heading">
              <div><h2>设备管理</h2><p>{statusMessage}</p></div>
              <div className="panel-actions">
                {isAdmin ? (
                  <button type="button" className="icon-button" onClick={() => void createShareLink()}>
                    <LinkIcon size={17} />生成客户链接
                  </button>
                ) : null}
                <button type="button" className="icon-button" onClick={() => void refreshDevices()}>
                  <RefreshCw size={17} />刷新列表
                </button>
              </div>
            </div>
            <div className="table-toolbar">
              <label className="search-field">
                <Search size={16} />
                <span className="sr-only">搜索设备名称或编号</span>
                <input aria-label="搜索设备名称或编号" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索设备名称或编号" />
              </label>
              <button type="button" className={`filter-chip ${statusFilter === "all" ? "active" : ""}`} onClick={() => setStatusFilter("all")}>全部 {totalDevices}</button>
              <button type="button" className={`filter-chip ${statusFilter === "online" ? "active online" : "online"}`} onClick={() => setStatusFilter("online")}>在线 {onlineCount}</button>
              <button type="button" className={`filter-chip ${statusFilter === "offline" ? "active" : ""}`} onClick={() => setStatusFilter("offline")}>离线 {state.devices.length - onlineCount}</button>
              {isAdmin ? (
                <>
                  <button type="button" className={`icon-button ${editLayout ? "primary" : ""}`} onClick={() => setEditLayout((value) => !value)}>
                    <Move size={17} />{editLayout ? "完成编辑" : "编辑布局"}
                  </button>
                  {editLayout && unplacedDevices.length > 0 ? (
                    <label className="layout-binding-field">
                      <span>新增卡片</span>
                      <select aria-label="选择要添加的设备" value={addDeviceId} onChange={(event) => setAddDeviceId(event.target.value)}>
                        {unplacedDevices.map((device) => (
                          <option key={device.id} value={device.id}>{device.displayName}</option>
                        ))}
                      </select>
                      <button type="button" className="icon-button" onClick={() => void addDeviceCard()}>
                        <Plus size={17} />添加卡片
                      </button>
                    </label>
                  ) : null}
                  <button type="button" className="icon-button" disabled={!selectedLayout} onClick={() => void moveSelectedLayer("front")}>置顶</button>
                  <button type="button" className="icon-button" disabled={!selectedLayout} onClick={() => void moveSelectedLayer("back")}>置底</button>
                  <button type="button" className="icon-button" onClick={() => void resetLayouts()}>重置布局</button>
                  {editLayout && selectedDevice && selectedLayout ? (
                    <label className="layout-binding-field">
                      <span>绑定开发板</span>
                      <select value={selectedDevice.id} onChange={rebindSelectedLayout}>
                        {rebindableDevices.map((device) => (
                          <option key={device.id} value={device.id}>{device.displayName}</option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  {editLayout && selectedLayout ? (
                    <button type="button" className="icon-button danger" onClick={() => void deleteSelectedLayout()}>
                      <Trash2 size={17} />删除卡片
                    </button>
                  ) : null}
                </>
              ) : null}
              <span className={`layout-save ${layoutSaveState}`}>{saveStateLabel(layoutSaveState)}</span>
            </div>
            <div className={`field-map ${editLayout ? "editing" : ""}`} role="region" aria-label="自由场地图" ref={canvasRef}>
              <div className="field-map-grid" aria-hidden="true" />
              <div className="field-map-label top-left">北区温室</div>
              <div className="field-map-label bottom-right">南区育苗</div>
              {visibleFieldCards.map(({ device, layout }) => (
                <div
                  key={device.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`查看 ${device.id} ${device.displayName}`}
                  className={`field-card ${device.status} ${device.id === selectedDevice?.id ? "selected" : ""}`}
                  style={{
                    left: `${layout.xPct}%`,
                    top: `${layout.yPct}%`,
                    width: `${layout.widthPct}%`,
                    height: `${layout.heightPct}%`,
                    zIndex: layout.zIndex
                  }}
                  onClick={() => setSelectedDeviceId(device.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedDeviceId(device.id);
                    }
                  }}
                  onPointerDown={(event) => beginLayoutDrag(event, device.id, "move")}
                >
                  <div className="field-card-header">
                    <span className={`status ${device.status}`}>{device.status === "online" ? <Wifi size={14} /> : <WifiOff size={14} />}{statusLabel(device.status)}</span>
                    {editLayout ? <Move size={15} className="field-card-move" /> : null}
                  </div>
                  <strong>{layout.title}</strong>
                  <span>{device.displayName}</span>
                  <small>{device.id}</small>
                  <div className="field-card-meta">
                    <span>{irrigationStateLabel(device.irrigationState)}{device.irrigationRemainingSec ? ` ${device.irrigationRemainingSec}秒` : ""}</span>
                    <span>{device.nextScheduleLabel ?? "无定时"}</span>
                    <span>{device.status === "online" ? "预览可用" : "预览离线"}</span>
                  </div>
                  {editLayout ? (
                    <span
                      className="resize-handle"
                      aria-hidden="true"
                      onPointerDown={(event) => beginLayoutDrag(event, device.id, "resize")}
                    >
                      <Maximize2 size={14} />
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
            {isAdmin && unplacedDevices.length > 0 ? (
              <div className="unplaced-strip">
                <span>未布置设备</span>
                {unplacedDevices.map((device) => <button key={device.id} type="button" onClick={() => setSelectedDeviceId(device.id)}>{device.displayName}</button>)}
              </div>
            ) : null}
            <div className="table-footer">共 {totalDevices} 台设备 · 当前显示 {visibleFieldCards.length} 张地块卡片</div>
          </section>
        ) : null}

        {activeView === "links" && isAdmin ? (
          <section className="panel compact-panel">
            {selectedDevice ? <p className="action-message">当前链接设备：{selectedDevice.id}</p> : null}
            <h2>客户链接</h2>
            <p>生成客户专属链接后，客户打开链接只能查看自己分配的设备和实时预览。</p>
            <button type="button" className="icon-button primary" onClick={createShareLink}><LinkIcon size={17} />生成客户链接</button>
            <label className="full-field">
              <span>生成的链接</span>
              <input value={shareUrl} readOnly placeholder="生成后显示链接" />
            </label>
            <button type="button" className="icon-button"><Copy size={17} />复制链接</button>
          </section>
        ) : null}

        {activeView === "account" && !shareMode ? (
          <section className="panel compact-panel">
            <h2>账号设置</h2>
            <label className="full-field"><span>姓名</span><input value={accountName} onChange={(event) => setAccountName(event.target.value)} /></label>
            <label className="full-field"><span>邮箱</span><input value={accountEmail} onChange={(event) => setAccountEmail(event.target.value)} /></label>
            <button type="button" className="icon-button primary" onClick={saveAccount}><Save size={17} />保存修改</button>
            {actionMessage ? <p className="action-message">{actionMessage}</p> : null}
          </section>
        ) : null}

        {activeView === "audit" ? (
          <section className="panel audit-panel">
            <h2>近期审计记录</h2>
            <ul>{state.audit.map((item) => <li key={item.id}><span>{item.label}</span><time>{item.time}</time></li>)}</ul>
          </section>
        ) : null}
      </section>

      {selectedDevice && (activeView === "devices" || activeView === "schedules") ? (
        <aside className="device-drawer" aria-label="设备详情">
          <div className="drawer-heading">
            <span className={`status ${selectedDevice.status}`}>{statusLabel(selectedDevice.status)}</span>
            <h2>{selectedDevice.displayName}</h2>
            <p>{selectedDevice.id} · {selectedDevice.location}</p>
          </div>
          <div className="preview-frame drawer-preview">
            {previewOpen && previewImageUrl ? <img className="preview-image" src={previewImageUrl} alt={`${selectedDevice.displayName} 实时摄像头画面`} /> : <Camera size={42} />}
          </div>
          <button type="button" className="icon-button" disabled={selectedDevice.status !== "online"} onClick={openPreview}>
            <Camera size={17} />{previewOpen ? "关闭实时预览" : "打开实时预览"}
          </button>

          <section className="drawer-section">
            <h3>浇灌控制</h3>
            <p>当前状态：{irrigationStateLabel(selectedDevice.irrigationState)}</p>
            <button type="button" className="icon-button primary" onClick={startIrrigation}><Droplets size={17} />下发限时浇灌</button>
          </section>

          <>
              <section className="drawer-section">
                <h3>一次性浇灌</h3>
                <label className="full-field"><span>一次预约时间</span><input type="datetime-local" value={oneTimeRunAt} onChange={(event) => setOneTimeRunAt(event.target.value)} /></label>
                <label className="full-field"><span>一次浇灌秒数</span><input type="number" min={1} max={900} value={oneTimeDuration} onChange={(event) => setOneTimeDuration(Number(event.target.value))} /></label>
                <button type="button" className="icon-button primary" onClick={() => void createSchedule("one_time")}><CalendarClock size={17} />创建一次预约</button>
              </section>
              <section className="drawer-section">
                <h3>每日重复定时</h3>
                <label className="full-field"><span>每日执行时间</span><input type="time" value={dailyTime} onChange={(event) => setDailyTime(event.target.value)} /></label>
                <label className="full-field"><span>每日浇灌秒数</span><input type="number" min={1} max={900} value={dailyDuration} onChange={(event) => setDailyDuration(Number(event.target.value))} /></label>
                <button type="button" className="icon-button primary" onClick={() => void createSchedule("daily")}><CalendarClock size={17} />创建每日定时</button>
              </section>
          </>
          {scheduleMessages.map((message, index) => (
            <p className="action-message" key={`${message}-${index}`}>{message}</p>
          ))}
          {actionMessage && scheduleMessages.length === 0 ? <p className="action-message">{actionMessage}</p> : null}
        </aside>
      ) : null}
    </main>
  );
}
