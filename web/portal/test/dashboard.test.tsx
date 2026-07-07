import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardShell, appendPreviewFrameParam, resolvePreviewUrl } from "../src/lib/dashboard-shell";
import { adminFixture, customerFixture } from "../src/lib/fixtures";

describe("DashboardShell", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows administrator controls and all assigned nursery devices to the platform admin", () => {
    render(<DashboardShell initialState={adminFixture} initialToken="test-token" autoRefresh={false} />);

    expect(screen.getByRole("heading", { name: "苗圃智能控制中心" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新增客户" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: adminFixture.devices[0].displayName })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: adminFixture.devices[1].displayName })).toBeInTheDocument();
  });

  it("hides administrator controls and exposes irrigation/video actions to customer users", () => {
    render(<DashboardShell initialState={customerFixture} initialToken="test-token" autoRefresh={false} />);

    expect(screen.queryByRole("button", { name: "新增客户" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: customerFixture.devices[0].displayName })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: adminFixture.devices[1].displayName })).not.toBeInTheDocument();
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

  it("adds a frame parameter to force live preview image refreshes", () => {
    expect(appendPreviewFrameParam("http://127.0.0.1:3001/api/devices/device-north-01/mjpeg/latest.jpg?token=abc.def", 3)).toBe(
      "http://127.0.0.1:3001/api/devices/device-north-01/mjpeg/latest.jpg?token=abc.def&frame=3"
    );
    expect(appendPreviewFrameParam("http://172.20.10.10:8080/stream.mjpg", 4)).toBe(
      "http://172.20.10.10:8080/stream.mjpg?frame=4"
    );
    expect(appendPreviewFrameParam(null, 4)).toBeNull();
  });

  it("shows a PC countdown immediately after an irrigation command is accepted", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
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

    render(<DashboardShell initialState={customerFixture} initialToken="test-token" autoRefresh={false} />);

    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "9" } });
    fireEvent.click(screen.getByRole("button", { name: /下发限时浇灌/ }));

    expect(await screen.findByText(/PC页面倒计时：剩余 9 秒/)).toBeInTheDocument();
  });
});

describe("DashboardShell device status synchronization", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a device-side irrigation countdown from refreshed device status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/api/devices")) {
          return Response.json([
            {
              id: "device-north-01",
              displayName: "North Greenhouse P4",
              location: "North greenhouse bench A",
              status: "online",
              irrigationState: "on",
              irrigationRemainingSec: 12,
              lastSeenAt: "2026-07-07T01:02:03.000Z",
              mjpegStreamUrl: "/api/devices/device-north-01/mjpeg/latest.jpg"
            }
          ]);
        }
        throw new Error(`Unexpected fetch ${url}`);
      })
    );

    render(<DashboardShell initialState={customerFixture} initialToken="test-token" />);

    expect(await screen.findByText(/设备端倒计时：剩余 12 秒/)).toBeInTheDocument();
  });
});
