import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardShell, resolvePreviewUrl } from "../src/lib/dashboard-shell";
import { adminFixture, customerFixture } from "../src/lib/fixtures";

describe("DashboardShell", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows administrator controls and all assigned nursery devices to the platform admin", () => {
    render(<DashboardShell initialState={adminFixture} />);

    expect(screen.getByRole("heading", { name: "苗圃智能控制中心" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新增客户" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "北区温室 P4" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "南区育苗台" })).toBeInTheDocument();
  });

  it("hides administrator controls and exposes irrigation/video actions to customer users", () => {
    render(<DashboardShell initialState={customerFixture} />);

    expect(screen.queryByRole("button", { name: "新增客户" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "北区温室 P4" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "南区育苗台" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打开实时预览" })).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: "浇灌时长 秒" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下发限时浇灌" })).toBeInTheDocument();
    expect(screen.getByText("视频模式：mjpeg")).toBeInTheDocument();
  });

  it("resolves relayed MJPEG API paths against the configured API base", () => {
    expect(resolvePreviewUrl("/api/devices/device-north-01/mjpeg/latest.jpg", "abc.def")).toBe(
      "http://127.0.0.1:3001/api/devices/device-north-01/mjpeg/latest.jpg?token=abc.def"
    );
    expect(resolvePreviewUrl("http://172.20.10.10:8080/stream.mjpg")).toBe("http://172.20.10.10:8080/stream.mjpg");
    expect(resolvePreviewUrl(null)).toBeNull();
  });

  it("shows a PC countdown immediately after an irrigation command is accepted", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url.endsWith("/auth/login")) {
          return Response.json({ accessToken: "test-token" });
        }
        if (url.includes("/irrigation-commands")) {
          return Response.json({ id: "irrigation-test", durationSec: 9, status: "queued" });
        }
        if (url.endsWith("/api/devices")) {
          return Response.json([
            {
              id: "device-north-01",
              displayName: "North Greenhouse P4",
              location: "North greenhouse bench A",
              status: "online",
              irrigationState: "off",
              lastSeenAt: "2026-07-06T20:56:01.000Z",
              mjpegStreamUrl: "/api/devices/device-north-01/mjpeg/latest.jpg"
            }
          ]);
        }
        throw new Error(`Unexpected fetch ${method} ${url}`);
      })
    );

    render(<DashboardShell initialState={customerFixture} />);

    await waitFor(() => expect(screen.getByText(/已连接本机后台|正在读取设备状态/)).toBeInTheDocument());
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "9" } });
    fireEvent.click(screen.getByRole("button", { name: /下发限时浇灌/ }));

    expect(await screen.findByText(/PC页面倒计时：剩余 9 秒/)).toBeInTheDocument();
  });
});
