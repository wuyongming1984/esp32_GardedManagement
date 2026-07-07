import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardShell, appendPreviewFrameParam, resolvePreviewUrl } from "../src/lib/dashboard-shell";
import { adminFixture, customerFixture } from "../src/lib/fixtures";

describe("DashboardShell device management", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a freeform field map and a right-side device drawer for platform admins", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/api/admin/device-layouts")) {
          return Response.json({ items: [] });
        }
        throw new Error(`Unexpected fetch ${url}`);
      })
    );

    render(<DashboardShell initialState={adminFixture} initialToken="test-token" autoRefresh={false} />);

    expect(screen.getByRole("heading", { name: "苗圃智能控制中心" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "搜索设备名称或编号" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "自由场地图" })).toBeInTheDocument();
    expect(await screen.findByText("已自动保存")).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "设备管理表格" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "生成客户链接" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /查看 device-north-01/ }));
    expect(screen.getByRole("complementary", { name: "设备详情" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: adminFixture.devices[0].displayName })).toBeInTheDocument();
  });

  it("auto-saves a device card layout after editing and dragging it", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/admin/device-layouts") && (!init?.method || init.method === "GET")) {
        return Response.json({
          items: [
            {
              deviceId: "device-north-01",
              title: "North irregular bed",
              xPct: 10,
              yPct: 12,
              widthPct: 24,
              heightPct: 20,
              zIndex: 1
            }
          ]
        });
      }
      if (url.endsWith("/api/admin/device-layouts") && init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as { items: Array<{ deviceId: string; xPct: number; yPct: number }> };
        expect(body.items.some((item) => item.deviceId === "device-north-01" && item.xPct !== 10 && item.yPct !== 12)).toBe(true);
        return Response.json(body);
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<DashboardShell initialState={adminFixture} initialToken="test-token" autoRefresh={false} />);

    expect(await screen.findByText("North irregular bed")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "编辑布局" }));
    const card = screen.getByRole("button", { name: /查看 device-north-01/ });

    fireEvent.pointerDown(card, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 220, clientY: 180, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 220, clientY: 180, pointerId: 1 });

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/device-layouts",
        expect.objectContaining({ method: "PUT" })
      )
    );
  });

  it("rebinds the selected field card to another board while editing the layout", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/admin/device-layouts") && (!init?.method || init.method === "GET")) {
        return Response.json({
          items: [
            {
              deviceId: "device-north-01",
              title: "North irregular bed",
              xPct: 10,
              yPct: 12,
              widthPct: 24,
              heightPct: 20,
              zIndex: 1
            },
            {
              deviceId: "device-south-01",
              title: "South propagation",
              xPct: 45,
              yPct: 30,
              widthPct: 24,
              heightPct: 20,
              zIndex: 2
            }
          ]
        });
      }
      if (url.endsWith("/api/admin/device-layouts") && init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as { items: Array<{ deviceId: string; xPct: number; yPct: number }> };
        expect(body.items).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ deviceId: "device-south-01", xPct: 10, yPct: 12 })
          ])
        );
        return Response.json(body);
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<DashboardShell initialState={adminFixture} initialToken="test-token" autoRefresh={false} />);

    fireEvent.click(await screen.findByRole("button", { name: /查看 device-north-01/ }));
    fireEvent.click(screen.getByRole("button", { name: "编辑布局" }));
    fireEvent.change(screen.getByLabelText("绑定开发板"), { target: { value: "device-south-01" } });

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/device-layouts",
        expect.objectContaining({ method: "PUT" })
      )
    );
  });

  it("creates one-time and daily irrigation schedules from the detail drawer", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/irrigation-schedules")) {
        return Response.json({ id: `schedule-${fetchMock.mock.calls.length}`, ...(JSON.parse(String(init?.body)) as object) });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<DashboardShell initialState={adminFixture} initialToken="test-token" autoRefresh={false} />);
    fireEvent.click(screen.getByRole("button", { name: /查看 device-north-01/ }));
    fireEvent.change(screen.getByLabelText("一次预约时间"), { target: { value: "2026-07-08T09:30" } });
    fireEvent.change(screen.getByLabelText("一次浇灌秒数"), { target: { value: "60" } });
    fireEvent.click(screen.getByRole("button", { name: "创建一次预约" }));
    fireEvent.change(screen.getByLabelText("每日执行时间"), { target: { value: "08:00" } });
    fireEvent.change(screen.getByLabelText("每日浇灌秒数"), { target: { value: "300" } });
    fireEvent.click(screen.getByRole("button", { name: "创建每日定时" }));

    expect(await screen.findByText("已创建一次预约")).toBeInTheDocument();
    expect(await screen.findByText("已创建每日定时")).toBeInTheDocument();
  });

  it("updates account information from the account settings page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/me")) {
          expect(init?.method).toBe("PATCH");
          return Response.json({ ...adminFixture.user, name: "管理员" });
        }
        throw new Error(`Unexpected fetch ${url}`);
      })
    );

    render(<DashboardShell initialState={adminFixture} initialToken="test-token" autoRefresh={false} />);
    fireEvent.click(screen.getByRole("link", { name: "账号设置" }));
    fireEvent.change(screen.getByLabelText("姓名"), { target: { value: "管理员" } });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));

    expect(await screen.findByText("账号信息已更新")).toBeInTheDocument();
  });

  it("generates a customer share link from the customer link page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/admin/share-links")) {
          expect(JSON.parse(String(init?.body))).toEqual({
            customerId: "customer-north",
            deviceId: "device-north-01"
          });
          return Response.json({
            id: "share-1",
            customerId: "customer-north",
            deviceId: "device-north-01",
            url: "http://8.153.162.62/share/token-1"
          });
        }
        throw new Error(`Unexpected fetch ${url}`);
      })
    );

    render(<DashboardShell initialState={adminFixture} initialToken="test-token" autoRefresh={false} />);
    fireEvent.click(screen.getByRole("link", { name: "客户链接" }));
    fireEvent.click(screen.getByRole("button", { name: "生成客户链接" }));

    expect(await screen.findByDisplayValue("http://8.153.162.62/share/token-1")).toBeInTheDocument();
  });

  it("generates and shows a customer share link from the device list toolbar", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/admin/share-links")) {
          expect(JSON.parse(String(init?.body))).toEqual({
            customerId: "customer-north",
            deviceId: "device-north-01"
          });
          return Response.json({
            id: "share-1",
            customerId: "customer-north",
            deviceId: "device-north-01",
            url: "http://8.153.162.62/share/token-1"
          });
        }
        throw new Error(`Unexpected fetch ${url}`);
      })
    );

    render(<DashboardShell initialState={adminFixture} initialToken="test-token" autoRefresh={false} />);
    fireEvent.click(screen.getByRole("button", { name: "生成客户链接" }));

    expect(await screen.findByDisplayValue("http://8.153.162.62/share/token-1")).toBeInTheDocument();
    expect(screen.getByText("当前链接设备：device-north-01")).toBeInTheDocument();
  });

  it("exchanges a customer share token and allows managing only that linked device", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/auth/share-links/share-token/exchange")) {
        return Response.json({ accessToken: "share-access-token", user: customerFixture.user });
      }
      if (url.endsWith("/api/devices")) {
        return Response.json([customerFixture.devices[0]]);
      }
      if (url.endsWith("/api/devices/device-north-01/irrigation-commands")) {
        expect(JSON.parse(String(init?.body))).toEqual({ durationSec: 60 });
        return Response.json({ id: "command-1", deviceId: "device-north-01", durationSec: 60, status: "queued" });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<DashboardShell initialState={adminFixture} initialShareToken="share-token" />);

    const irrigateButton = await screen.findByRole("button", { name: "下发限时浇灌" });
    fireEvent.click(irrigateButton);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/devices/device-north-01/irrigation-commands",
        expect.objectContaining({ method: "POST" })
      )
    );
    expect(screen.queryByRole("link", { name: "账号设置" })).not.toBeInTheDocument();
  });
});

describe("preview URL helpers", () => {
  it("resolves relayed MJPEG API paths against the configured API base", () => {
    expect(resolvePreviewUrl("/api/devices/device-north-01/mjpeg/latest.jpg", "abc.def")).toBe(
      "/api/devices/device-north-01/mjpeg/latest.jpg?token=abc.def"
    );
    expect(resolvePreviewUrl("http://172.20.10.10:8080/stream.mjpg")).toBe("http://172.20.10.10:8080/stream.mjpg");
    expect(resolvePreviewUrl(null)).toBeNull();
  });

  it("adds a frame parameter to force live preview image refreshes", () => {
    expect(appendPreviewFrameParam("/api/devices/device-north-01/mjpeg/latest.jpg?token=abc.def", 3)).toBe(
      "/api/devices/device-north-01/mjpeg/latest.jpg?token=abc.def&frame=3"
    );
    expect(appendPreviewFrameParam("http://172.20.10.10:8080/stream.mjpg", 4)).toBe(
      "http://172.20.10.10:8080/stream.mjpg?frame=4"
    );
    expect(appendPreviewFrameParam(null, 4)).toBeNull();
  });
});
