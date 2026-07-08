import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardShell, appendPreviewFrameParam, resolvePreviewUrl } from "../src/lib/dashboard-shell";
import { adminFixture, customerFixture } from "../src/lib/fixtures";

describe("DashboardShell device management", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function plotNorth(overrides: Record<string, unknown> = {}) {
    return {
      id: "plot-north",
      deviceId: "device-north-01",
      title: "North irregular bed",
      xPct: 10,
      yPct: 12,
      widthPct: 24,
      heightPct: 20,
      zIndex: 1,
      ...overrides
    };
  }

  function plotSouth(overrides: Record<string, unknown> = {}) {
    return {
      id: "plot-south",
      deviceId: "device-south-01",
      title: "South propagation",
      xPct: 45,
      yPct: 30,
      widthPct: 24,
      heightPct: 20,
      zIndex: 2,
      ...overrides
    };
  }

  it("shows a freeform field map and a right-side device drawer for platform admins", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/api/admin/device-layouts")) {
          return Response.json({ items: [plotNorth()] });
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

    fireEvent.click(screen.getByRole("button", { name: /查看地块 North irregular bed/ }));
    expect(screen.getByRole("complementary", { name: "设备详情" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: adminFixture.devices[0].displayName })).toBeInTheDocument();
  });

  it("keeps devices unplaced when the saved layout collection is empty", async () => {
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

    expect(await screen.findByText("已自动保存")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /查看 device-north-01/ })).not.toBeInTheDocument();
    expect(screen.getByText("未绑定设备")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: adminFixture.devices[0].displayName })).toBeInTheDocument();
  });

  it("auto-saves a plot card layout after editing and dragging it", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/admin/device-layouts") && (!init?.method || init.method === "GET")) {
        return Response.json({ items: [plotNorth()] });
      }
      if (url.endsWith("/api/admin/device-layouts") && init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as { items: Array<{ id: string; xPct: number; yPct: number }> };
        expect(body.items.some((item) => item.id === "plot-north" && item.xPct !== 10 && item.yPct !== 12)).toBe(true);
        return Response.json(body);
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<DashboardShell initialState={adminFixture} initialToken="test-token" autoRefresh={false} />);

    expect(await screen.findByText("North irregular bed")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "编辑布局" }));
    const card = screen.getByRole("button", { name: /查看地块 North irregular bed/ });

    fireEvent.pointerDown(card, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 220, clientY: 180, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 220, clientY: 180, pointerId: 1 });

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/device-layouts",
        expect.objectContaining({ method: "PUT" })
      )
    );
    expect(await screen.findByText("已自动保存")).toBeInTheDocument();
  });

  it("binds an empty field card to an available board while editing the layout", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/admin/device-layouts") && (!init?.method || init.method === "GET")) {
        return Response.json({
          items: [
            plotNorth(),
            plotSouth({ id: "plot-empty", deviceId: undefined, title: "Empty bed", xPct: 40 })
          ]
        });
      }
      if (url.endsWith("/api/admin/device-layouts") && init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as { items: Array<{ id: string; deviceId?: string; xPct: number }> };
        expect(body.items).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: "plot-empty", deviceId: "device-south-01", xPct: 40 })
          ])
        );
        return Response.json(body);
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<DashboardShell initialState={adminFixture} initialToken="test-token" autoRefresh={false} />);

    fireEvent.click(await screen.findByRole("button", { name: /查看地块 Empty bed/ }));
    fireEvent.click(screen.getByRole("button", { name: "编辑布局" }));
    fireEvent.change(screen.getByLabelText("绑定设备"), { target: { value: "device-south-01" } });

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/device-layouts",
        expect.objectContaining({ method: "PUT" })
      )
    );
  });

  it("creates an unbound plot card even when every device is already bound", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/admin/device-layouts") && (!init?.method || init.method === "GET")) {
        return Response.json({ items: [plotNorth(), plotSouth()] });
      }
      if (url.endsWith("/api/admin/device-layouts") && init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as { items: Array<{ id: string; deviceId?: string; title: string }> };
        expect(body.items).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ title: expect.stringMatching(/^未命名地块/), deviceId: undefined })
          ])
        );
        return Response.json(body);
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<DashboardShell initialState={adminFixture} initialToken="test-token" autoRefresh={false} />);

    expect(await screen.findByText("已自动保存")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "编辑布局" }));
    fireEvent.click(screen.getByRole("button", { name: "新增地块" }));

    expect(await screen.findByRole("button", { name: /查看地块 未命名地块/ })).toBeInTheDocument();
    expect(screen.getAllByText("未绑定设备").length).toBeGreaterThan(0);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/device-layouts",
        expect.objectContaining({ method: "PUT" })
      )
    );
  });

  it("hides device controls for an unbound selected plot card", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/api/admin/device-layouts")) {
          return Response.json({ items: [plotNorth({ id: "plot-empty", deviceId: undefined, title: "Empty bed" })] });
        }
        throw new Error(`Unexpected fetch ${url}`);
      })
    );

    render(<DashboardShell initialState={adminFixture} initialToken="test-token" autoRefresh={false} />);

    fireEvent.click(await screen.findByRole("button", { name: /查看地块 Empty bed/ }));

    expect(screen.getByRole("complementary", { name: "设备详情" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Empty bed" })).toBeInTheDocument();
    expect(screen.getAllByText("未绑定设备").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "打开实时预览" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "下发限时浇灌" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "创建一次预约" })).not.toBeInTheDocument();
  });

  it("edits selected plot card name and description while autosaving", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/admin/device-layouts") && (!init?.method || init.method === "GET")) {
        return Response.json({
          items: [plotNorth({ id: "plot-empty", deviceId: undefined, title: "Empty bed", subtitle: "Waiting for board binding" })]
        });
      }
      if (url.endsWith("/api/admin/device-layouts") && init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as { items: Array<{ id: string; title: string; subtitle?: string }> };
        expect(body.items).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: "plot-empty", title: "育苗观察区", subtitle: "南侧补光试验" })
          ])
        );
        return Response.json(body);
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<DashboardShell initialState={adminFixture} initialToken="test-token" autoRefresh={false} />);

    fireEvent.click(await screen.findByRole("button", { name: /查看地块 Empty bed/ }));
    fireEvent.click(screen.getByRole("button", { name: "编辑布局" }));
    fireEvent.change(screen.getByLabelText("地块名称"), { target: { value: "育苗观察区" } });
    fireEvent.change(screen.getByLabelText("地块说明"), { target: { value: "南侧补光试验" } });

    await waitFor(() => expect(screen.getAllByText("育苗观察区").length).toBeGreaterThan(0));
    expect(screen.getAllByText("南侧补光试验").length).toBeGreaterThan(0);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/device-layouts",
        expect.objectContaining({ method: "PUT" })
      )
    );
  });

  it("binds a selected plot card from the detail panel", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/admin/device-layouts") && (!init?.method || init.method === "GET")) {
        return Response.json({
          items: [plotNorth(), plotSouth({ id: "plot-empty", deviceId: undefined, title: "Empty bed" })]
        });
      }
      if (url.endsWith("/api/admin/device-layouts") && init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as { items: Array<{ id: string; deviceId?: string }> };
        expect(body.items).toEqual(
          expect.arrayContaining([expect.objectContaining({ id: "plot-empty", deviceId: "device-south-01" })])
        );
        return Response.json(body);
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<DashboardShell initialState={adminFixture} initialToken="test-token" autoRefresh={false} />);

    fireEvent.click(await screen.findByRole("button", { name: /查看地块 Empty bed/ }));
    fireEvent.click(screen.getByRole("button", { name: "编辑布局" }));
    fireEvent.change(screen.getByLabelText("绑定设备"), { target: { value: "device-south-01" } });

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/device-layouts",
        expect.objectContaining({ method: "PUT" })
      )
    );
  });

  it("deletes the selected plot card and releases its device for another plot", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/admin/device-layouts") && (!init?.method || init.method === "GET")) {
        return Response.json({ items: [plotNorth(), plotSouth({ id: "plot-empty", deviceId: undefined, title: "Empty bed" })] });
      }
      if (url.endsWith("/api/admin/device-layouts") && init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as { items: Array<{ id: string; deviceId?: string }> };
        expect(body.items.some((item) => item.id === "plot-north")).toBe(false);
        return Response.json(body);
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<DashboardShell initialState={adminFixture} initialToken="test-token" autoRefresh={false} />);

    fireEvent.click(await screen.findByRole("button", { name: /查看地块 North irregular bed/ }));
    fireEvent.click(screen.getByRole("button", { name: "编辑布局" }));
    fireEvent.click(screen.getByRole("button", { name: "删除卡片" }));

    await waitFor(() => expect(screen.queryByRole("button", { name: /查看地块 North irregular bed/ })).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /查看地块 Empty bed/ }));
    expect(screen.getByRole("option", { name: adminFixture.devices[0].displayName })).toBeInTheDocument();
  });

  it("does not offer already bound devices when binding another plot", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/api/admin/device-layouts")) {
          return Response.json({
            items: [
              plotNorth(),
              plotSouth(),
              plotSouth({ id: "plot-empty", deviceId: undefined, title: "Empty bed", zIndex: 3 })
            ]
          });
        }
        throw new Error(`Unexpected fetch ${url}`);
      })
    );

    render(<DashboardShell initialState={adminFixture} initialToken="test-token" autoRefresh={false} />);

    fireEvent.click(await screen.findByRole("button", { name: /查看地块 Empty bed/ }));
    fireEvent.click(screen.getByRole("button", { name: "编辑布局" }));

    const bindingSelect = screen.getByLabelText("绑定设备");
    expect(bindingSelect).toHaveDisplayValue("未绑定设备");
    expect(screen.queryByRole("option", { name: adminFixture.devices[1].displayName })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: adminFixture.devices[0].displayName })).not.toBeInTheDocument();
  });

  it("creates one-time and daily irrigation schedules from the detail drawer", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/admin/device-layouts")) {
        return Response.json({ items: [] });
      }
      if (url.includes("/irrigation-schedules")) {
        return Response.json({ id: `schedule-${fetchMock.mock.calls.length}`, ...(JSON.parse(String(init?.body)) as object) });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<DashboardShell initialState={adminFixture} initialToken="test-token" autoRefresh={false} />);
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
