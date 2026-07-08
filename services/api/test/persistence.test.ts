import { afterEach, describe, expect, it, vi } from "vitest";
import { appState } from "../src/app-state.js";
import { createSeededNurseryDomain } from "../src/domain/seed.js";
import { PrismaPersistenceService } from "../src/persistence/prisma-persistence.service.js";

function resetStore() {
  const domain = createSeededNurseryDomain();
  Object.assign(appState.store, domain.store);
}

function emptyPrismaSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    user: { findMany: vi.fn().mockResolvedValue([]) },
    customer: { findMany: vi.fn().mockResolvedValue([]) },
    device: { findMany: vi.fn().mockResolvedValue([]) },
    plotCard: { findMany: vi.fn().mockResolvedValue([]) },
    deviceLayout: { findMany: vi.fn().mockResolvedValue([]) },
    deviceAssignment: { findMany: vi.fn().mockResolvedValue([]) },
    irrigationCommand: { findMany: vi.fn().mockResolvedValue([]) },
    irrigationSchedule: { findMany: vi.fn().mockResolvedValue([]) },
    videoSession: { findMany: vi.fn().mockResolvedValue([]) },
    customerShareLink: { findMany: vi.fn().mockResolvedValue([]) },
    auditLog: { findMany: vi.fn().mockResolvedValue([]) },
    ...overrides
  };
}

describe("Prisma persistence snapshots", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetStore();
  });

  it("does not load legacy customer share links without a device binding", async () => {
    const service = new PrismaPersistenceService();
    const legacyDate = new Date("2026-07-07T00:00:00.000Z");

    (service as unknown as { prisma: unknown }).prisma = emptyPrismaSnapshot({
      customer: { findMany: vi.fn().mockResolvedValue([{ id: "customer-north", name: "North", contactEmail: "north@example.com" }]) },
      device: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "device-north-01",
            displayName: "North Greenhouse P4",
            location: "North greenhouse bench A",
            status: "online",
            irrigationState: "off",
            irrigationRemainingSec: null,
            lastSeenAt: null,
            mjpegStreamUrl: null,
            mqttStatusTopic: "devices/device-north-01/status",
            mqttEventsTopic: "devices/device-north-01/events"
          }
        ])
      },
      customerShareLink: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "legacy-null-device",
            customerId: "customer-north",
            deviceId: null,
            tokenHash: "legacy-token",
            createdByUserId: "user-admin",
            createdAt: legacyDate,
            expiresAt: legacyDate,
            revokedAt: null
          },
          {
            id: "valid-device-link",
            customerId: "customer-north",
            deviceId: "device-north-01",
            tokenHash: "valid-token",
            createdByUserId: "user-admin",
            createdAt: legacyDate,
            expiresAt: legacyDate,
            revokedAt: null
          }
        ])
      }
    });

    await (service as unknown as { loadSnapshot: () => Promise<void> }).loadSnapshot();

    expect(appState.store.shareLinks.has("legacy-null-device")).toBe(false);
    expect(appState.store.shareLinks.get("valid-device-link")?.deviceId).toBe("device-north-01");
  });

  it("converts legacy device layouts to plot cards when the plot card table is empty", async () => {
    const service = new PrismaPersistenceService();
    const legacyDate = new Date("2026-07-07T00:00:00.000Z");

    (service as unknown as { prisma: unknown }).prisma = emptyPrismaSnapshot({
      device: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "device-north-01",
            displayName: "North Greenhouse P4",
            location: "North greenhouse bench A",
            status: "online",
            irrigationState: "off",
            irrigationRemainingSec: null,
            lastSeenAt: null,
            mjpegStreamUrl: null,
            mqttStatusTopic: "devices/device-north-01/status",
            mqttEventsTopic: "devices/device-north-01/events"
          }
        ])
      },
      plotCard: { findMany: vi.fn().mockResolvedValue([]) },
      deviceLayout: {
        findMany: vi.fn().mockResolvedValue([
          {
            deviceId: "device-north-01",
            title: "Legacy north bed",
            xPct: 11,
            yPct: 12,
            widthPct: 25,
            heightPct: 21,
            zIndex: 4,
            updatedAt: legacyDate
          }
        ])
      }
    });

    await (service as unknown as { loadSnapshot: () => Promise<void> }).loadSnapshot();

    expect(appState.store.plotCards.get("plot-device-north-01")).toMatchObject({
      id: "plot-device-north-01",
      deviceId: "device-north-01",
      title: "Legacy north bed",
      xPct: 11,
      zIndex: 4
    });
  });
});
