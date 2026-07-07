"use client";

import { Camera, Droplets, Leaf, LogIn, Plus, RefreshCw, Shield, Wifi, WifiOff } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { PortalDevice, PortalState, PortalUser } from "./types";

interface DashboardShellProps {
  initialState: PortalState;
  initialToken?: string;
  autoRefresh?: boolean;
}

interface ApiDevice {
  id: string;
  displayName: string;
  location: string;
  status: PortalDevice["status"];
  irrigationState: PortalDevice["irrigationState"];
  irrigationRemainingSec?: number;
  lastSeenAt?: string;
  mjpegStreamUrl?: string;
}

interface ApiVideoSession {
  id: string;
  mode: PortalDevice["videoMode"];
  mjpegUrl?: string;
}

interface ApiLoginResponse {
  accessToken: string;
  user: PortalUser;
}

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3001";
const DEFAULT_LOGIN_EMAIL = process.env.NEXT_PUBLIC_DEMO_ADMIN_EMAIL ?? "admin@nursery.local";

export function resolvePreviewUrl(value?: string | null, token?: string | null) {
  if (!value) {
    return null;
  }
  if (value.startsWith("/")) {
    const separator = value.includes("?") ? "&" : "?";
    const tokenQuery = token ? `${separator}token=${encodeURIComponent(token)}` : "";
    return `${API_BASE}${value}${tokenQuery}`;
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
  if (status === "online") {
    return "在线";
  }
  if (status === "fault") {
    return "故障";
  }
  return "离线";
}

function irrigationStateLabel(state: PortalDevice["irrigationState"]) {
  return state === "on" ? "开启" : "关闭";
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
    lastSeenLabel: formatLastSeen(device.lastSeenAt),
    mjpegStreamUrl: device.mjpegStreamUrl,
    videoMode: "mjpeg"
  };
}

function DeviceRow({
  device,
  token,
  onRefresh
}: {
  device: PortalDevice;
  token: string | null;
  onRefresh: () => Promise<void>;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(resolvePreviewUrl(device.mjpegStreamUrl, token));
  const [previewFrameSeq, setPreviewFrameSeq] = useState(0);
  const [videoMessage, setVideoMessage] = useState("尚未打开预览");
  const [durationSec, setDurationSec] = useState(5);
  const [commandMessage, setCommandMessage] = useState("未下发浇灌命令");
  const [irrigationRemainingSec, setIrrigationRemainingSec] = useState<number | null>(null);
  const [irrigationEndsAt, setIrrigationEndsAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const isOnline = device.status === "online";

  const pcRemainingSec = irrigationRemainingSec !== null && irrigationRemainingSec > 0 ? irrigationRemainingSec : null;
  const deviceRemainingSec =
    device.irrigationState === "on" && typeof device.irrigationRemainingSec === "number" && device.irrigationRemainingSec > 0
      ? device.irrigationRemainingSec
      : null;
  const visibleRemainingSec = pcRemainingSec ?? deviceRemainingSec;
  const countdownLabel = pcRemainingSec !== null ? "PC页面倒计时" : "设备端倒计时";
  const previewImageUrl = appendPreviewFrameParam(previewUrl, previewFrameSeq);

  useEffect(() => {
    if (!irrigationEndsAt) {
      return;
    }

    const updateCountdown = () => {
      const remaining = Math.max(0, Math.ceil((irrigationEndsAt - Date.now()) / 1000));
      setIrrigationRemainingSec(remaining);
      if (remaining <= 0) {
        setIrrigationEndsAt(null);
        setCommandMessage("浇灌倒计时结束，设备应已自动关闭");
        void onRefresh();
      }
    };

    updateCountdown();
    const timer = window.setInterval(updateCountdown, 1000);
    return () => window.clearInterval(timer);
  }, [irrigationEndsAt, onRefresh]);

  useEffect(() => {
    if (!previewOpen) {
      return;
    }

    const timer = window.setInterval(() => {
      setPreviewFrameSeq((value) => value + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [previewOpen]);

  async function openPreview() {
    if (!token) {
      setVideoMessage("后台登录尚未完成");
      return;
    }
    if (previewOpen) {
      setPreviewOpen(false);
      setPreviewFrameSeq(0);
      setVideoMessage("预览已关闭");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`${API_BASE}/api/devices/${device.id}/video-sessions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({ preferredMode: "mjpeg" })
      });
      if (!response.ok) {
        throw new Error(`视频会话创建失败：${response.status}`);
      }
      const session = (await response.json()) as ApiVideoSession;
      const streamUrl = resolvePreviewUrl(session.mjpegUrl ?? device.mjpegStreamUrl, token);
      setPreviewOpen(true);
      setPreviewUrl(streamUrl);
      setPreviewFrameSeq(0);
      setVideoMessage(streamUrl ? `正在读取实际摄像头画面：${session.mode}` : `视频会话已创建：${session.mode}`);
    } catch (error) {
      setVideoMessage(error instanceof Error ? error.message : "视频会话创建失败");
    } finally {
      setBusy(false);
    }
  }

  async function startIrrigation() {
    if (!token) {
      setCommandMessage("后台登录尚未完成");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`${API_BASE}/api/devices/${device.id}/irrigation-commands`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({ durationSec })
      });
      if (!response.ok) {
        throw new Error(`浇灌命令下发失败：${response.status}`);
      }
      const command = await response.json();
      const countdownSec = Number(command.durationSec ?? durationSec);
      setIrrigationRemainingSec(countdownSec);
      setIrrigationEndsAt(Date.now() + countdownSec * 1000);
      setCommandMessage(`正在浇灌，剩余 ${countdownSec} 秒`);
      await onRefresh();
    } catch (error) {
      setCommandMessage(error instanceof Error ? error.message : "浇灌命令下发失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="device-row" aria-label={device.displayName}>
      <div className="device-main">
        <div className="device-icon" aria-hidden="true">
          <Leaf size={20} />
        </div>
        <div>
          <h3>{device.displayName}</h3>
          <p>{device.location}</p>
        </div>
      </div>
      <div className="device-meta">
        <span className={`status ${device.status}`}>
          {isOnline ? <Wifi size={15} /> : <WifiOff size={15} />}
          {statusLabel(device.status)}
        </span>
        <span>最后上线：{device.lastSeenLabel}</span>
        <span>浇灌 IO：{irrigationStateLabel(device.irrigationState)}</span>
        <span>视频模式：{device.videoMode}</span>
      </div>
      <div className="device-actions">
        <button type="button" className="icon-button" disabled={busy || !isOnline} onClick={openPreview}>
          <Camera size={17} />
          {previewOpen ? "关闭实时预览" : "打开实时预览"}
        </button>
        <label className="duration-field">
          <span>浇灌时长</span>
          <input
            min={1}
            max={900}
            type="number"
            value={durationSec}
            onChange={(event) => setDurationSec(Number(event.target.value))}
          />
          <span>秒</span>
        </label>
        <button type="button" className="icon-button primary" disabled={busy || !isOnline} onClick={startIrrigation}>
          <Droplets size={17} />
          下发限时浇灌
        </button>
      </div>
      {previewOpen ? (
        <div className="preview-panel">
          <div className="preview-frame">
            {previewImageUrl ? (
              <img className="preview-image" src={previewImageUrl} alt={`${device.displayName} 实时摄像头画面`} />
            ) : (
              <>
                <div className="scanline" />
                <span>{device.videoMode.toUpperCase()} 实时预览等待设备流</span>
              </>
            )}
          </div>
          <p>{videoMessage}</p>
        </div>
      ) : null}
      {visibleRemainingSec !== null ? (
        <p className="device-note countdown-note">{countdownLabel}：剩余 {visibleRemainingSec} 秒</p>
      ) : null}
      <p className="device-note">{commandMessage}</p>
    </section>
  );
}

export function DashboardShell({ initialState, initialToken, autoRefresh = true }: DashboardShellProps) {
  const [state, setState] = useState(initialState);
  const [token, setToken] = useState<string | null>(initialToken ?? null);
  const [statusMessage, setStatusMessage] = useState(initialToken ? "已登录，正在读取设备状态..." : "请先登录后台");
  const [loginEmail, setLoginEmail] = useState(DEFAULT_LOGIN_EMAIL);
  const [loginMessage, setLoginMessage] = useState("请输入平台管理员或客户账号邮箱");
  const [loginBusy, setLoginBusy] = useState(false);
  const isAdmin = state.user.role === "platform_admin";

  const refreshDevices = useCallback(async () => {
    if (!token) {
      return;
    }
    const response = await fetch(`${API_BASE}/api/devices`, {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store"
    });
    if (!response.ok) {
      throw new Error(`设备列表读取失败：${response.status}`);
    }
    const devices = (await response.json()) as ApiDevice[];
    setState((current) => ({
      ...current,
      devices: devices.map(mapApiDevice),
      audit: [
        {
          id: `live-${Date.now()}`,
          label: "已从本机 API 刷新设备状态",
          time: new Date().toLocaleTimeString("zh-CN")
        },
        ...current.audit.slice(0, 4)
      ]
    }));
    setStatusMessage("已连接后台，设备状态为实时数据");
  }, [token]);

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = loginEmail.trim();
    if (!email) {
      setLoginMessage("请输入登录邮箱");
      return;
    }

    setLoginBusy(true);
    setLoginMessage("正在登录...");
    try {
      const response = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email })
      });
      if (!response.ok) {
        throw new Error(response.status === 401 ? "账号不存在，请检查邮箱" : `登录失败：${response.status}`);
      }
      const body = (await response.json()) as ApiLoginResponse;
      setState((current) => ({
        ...current,
        user: body.user,
        devices: [],
        audit: [
          {
            id: `login-${Date.now()}`,
            label: "登录成功，正在读取设备状态",
            time: new Date().toLocaleTimeString("zh-CN")
          },
          ...current.audit.slice(0, 4)
        ]
      }));
      setToken(body.accessToken);
      setStatusMessage("登录成功，正在读取设备状态...");
      setLoginMessage("登录成功");
    } catch (error) {
      setLoginMessage(error instanceof Error ? error.message : "登录失败");
    } finally {
      setLoginBusy(false);
    }
  }

  useEffect(() => {
    if (!token || !autoRefresh) {
      return;
    }
    void refreshDevices().catch((error) => setStatusMessage(error instanceof Error ? error.message : "设备刷新失败"));
    const timer = window.setInterval(() => {
      void refreshDevices().catch((error) => setStatusMessage(error instanceof Error ? error.message : "设备刷新失败"));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, refreshDevices, token]);

  const onlineCount = useMemo(
    () => state.devices.filter((device) => device.status === "online").length,
    [state.devices]
  );

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
          <p>请输入平台管理员或客户账号邮箱，登录后查看设备、实时预览和浇灌状态。</p>
          <form className="login-form" onSubmit={submitLogin}>
            <label htmlFor="login-email">登录邮箱</label>
            <input
              id="login-email"
              type="email"
              value={loginEmail}
              onChange={(event) => setLoginEmail(event.target.value)}
              autoComplete="username"
              placeholder="admin@nursery.local"
            />
            <button type="submit" className="icon-button primary" disabled={loginBusy}>
              <LogIn size={17} />
              {loginBusy ? "登录中..." : "登录"}
            </button>
          </form>
          <p className="login-hint">管理员：admin@nursery.local；客户：north-client@example.com</p>
          <p className="login-message" role="status">{loginMessage}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Leaf size={22} />
          </div>
          <div>
            <strong>苗圃智能</strong>
            <span>ESP32-P4 设备群</span>
          </div>
        </div>
        <nav aria-label="主导航">
          <a className="active" href="#devices">
            设备
          </a>
          <a href="#audit">审计</a>
          {isAdmin ? <a href="#customers">客户</a> : null}
        </nav>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <h1>苗圃智能控制中心</h1>
            <p>{isAdmin ? "平台管理员视图" : "客户设备视图"}</p>
          </div>
          <div className="user-pill">
            <Shield size={16} />
            {state.user.name}
          </div>
        </header>

        <section className="summary-grid" aria-label="系统概览">
          <div>
            <span>设备总数</span>
            <strong>{state.devices.length}</strong>
          </div>
          <div>
            <span>在线设备</span>
            <strong>{onlineCount}</strong>
          </div>
          <div>
            <span>安全关闭策略</span>
            <strong>已启用</strong>
          </div>
        </section>

        <section id="devices" className="panel">
          <div className="panel-heading">
            <div>
              <h2>已分配设备</h2>
              <p>{statusMessage}</p>
            </div>
            <div className="heading-actions">
              <button
                type="button"
                className="icon-button"
                onClick={() => void refreshDevices().catch((error) => setStatusMessage(error.message))}
              >
                <RefreshCw size={17} />
                刷新状态
              </button>
              {isAdmin ? (
                <button type="button" className="icon-button">
                  <Plus size={17} />
                  新增客户
                </button>
              ) : null}
            </div>
          </div>
          <div className="device-list">
            {state.devices.map((device) => (
              <DeviceRow key={device.id} device={device} token={token} onRefresh={refreshDevices} />
            ))}
          </div>
        </section>

        <section id="audit" className="panel audit-panel">
          <div className="panel-heading">
            <div>
              <h2>近期审计记录</h2>
              <p>浇灌命令、视频会话和设备健康事件。</p>
            </div>
          </div>
          <ul>
            {state.audit.map((item) => (
              <li key={item.id}>
                <span>{item.label}</span>
                <time>{item.time}</time>
              </li>
            ))}
          </ul>
        </section>
      </section>
    </main>
  );
}
