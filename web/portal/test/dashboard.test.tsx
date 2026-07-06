import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DashboardShell, resolvePreviewUrl } from "../src/lib/dashboard-shell";
import { adminFixture, customerFixture } from "../src/lib/fixtures";

describe("DashboardShell", () => {
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
    expect(resolvePreviewUrl("/api/devices/device-north-01/mjpeg/latest.jpg")).toBe(
      "http://127.0.0.1:3001/api/devices/device-north-01/mjpeg/latest.jpg"
    );
    expect(resolvePreviewUrl("http://172.20.10.10:8080/stream.mjpg")).toBe("http://172.20.10.10:8080/stream.mjpg");
    expect(resolvePreviewUrl(null)).toBeNull();
  });
});
