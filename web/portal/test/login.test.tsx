import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardShell } from "../src/lib/dashboard-shell";
import { adminFixture } from "../src/lib/fixtures";

describe("DashboardShell login", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a Chinese login page before loading the dashboard", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/auth/login")) {
        expect(init?.method).toBe("POST");
        expect(init?.body).toBe(JSON.stringify({ email: "north-client@example.com" }));
        return Response.json({
          accessToken: "customer-token",
          user: {
            id: "user-customer-north",
            email: "north-client@example.com",
            name: "North Client",
            role: "customer",
            customerId: "customer-north"
          }
        });
      }
      if (url.endsWith("/api/devices")) {
        return Response.json([
          {
            id: "device-north-01",
            displayName: "North Greenhouse P4",
            location: "North greenhouse bench A",
            status: "online",
            irrigationState: "off",
            lastSeenAt: "2026-07-07T01:02:03.000Z",
            mjpegStreamUrl: "/api/devices/device-north-01/mjpeg/latest.jpg"
          }
        ]);
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<DashboardShell initialState={adminFixture} />);

    expect(screen.getByRole("heading", { name: "苗圃智能登录" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "苗圃智能控制中心" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("登录邮箱"), { target: { value: "north-client@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "登录" }));

    expect(await screen.findByRole("heading", { name: "苗圃智能控制中心" })).toBeInTheDocument();
    expect(await screen.findByText("North Client")).toBeInTheDocument();
  });
});
