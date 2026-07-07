import { createOpaqueToken, hashOpaqueToken } from "../auth/security.js";
import { AccessControl } from "./access-control.js";
import { AuditService } from "./audit.service.js";
import { createDomainId } from "./id.js";
import { CustomerShareLink, NurseryStore } from "./types.js";

export class ShareLinkService {
  private readonly access: AccessControl;
  private readonly audit: AuditService;

  constructor(private readonly store: NurseryStore) {
    this.access = new AccessControl(store);
    this.audit = new AuditService(store);
  }

  create(input: { actorUserId: string; customerId: string; baseUrl?: string }): CustomerShareLink & { token: string; url: string } {
    const actor = this.access.requireUser(input.actorUserId);
    if (actor.role !== "platform_admin") {
      throw new Error("Platform admin role required");
    }
    if (!this.store.customers.has(input.customerId)) {
      throw new Error("Customer not found");
    }

    const token = createOpaqueToken();
    const now = new Date();
    const link: CustomerShareLink = {
      id: createDomainId("share"),
      customerId: input.customerId,
      tokenHash: hashOpaqueToken(token),
      createdByUserId: input.actorUserId,
      createdAt: now,
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
    };
    this.store.shareLinks.set(link.id, link);
    this.audit.record({
      actorUserId: input.actorUserId,
      action: "share_link.created",
      metadata: { shareLinkId: link.id, customerId: input.customerId }
    });
    const baseUrl = input.baseUrl ?? process.env.PUBLIC_APP_URL ?? "http://127.0.0.1:3003";
    return { ...link, token, url: `${baseUrl.replace(/\/$/, "")}/share/${token}` };
  }

  list(actorUserId: string): CustomerShareLink[] {
    const actor = this.access.requireUser(actorUserId);
    if (actor.role !== "platform_admin") {
      throw new Error("Platform admin role required");
    }
    return Array.from(this.store.shareLinks.values());
  }

  revoke(actorUserId: string, shareLinkId: string): CustomerShareLink {
    const actor = this.access.requireUser(actorUserId);
    if (actor.role !== "platform_admin") {
      throw new Error("Platform admin role required");
    }
    const link = this.store.shareLinks.get(shareLinkId);
    if (!link) {
      throw new Error("Share link not found");
    }
    link.revokedAt = new Date();
    this.audit.record({
      actorUserId,
      action: "share_link.revoked",
      metadata: { shareLinkId, customerId: link.customerId }
    });
    return link;
  }

  exchange(token: string): CustomerShareLink {
    const tokenHash = hashOpaqueToken(token);
    const link = Array.from(this.store.shareLinks.values()).find((candidate) => candidate.tokenHash === tokenHash);
    if (!link || link.revokedAt || link.expiresAt.getTime() <= Date.now()) {
      throw new Error("Share link is invalid or expired");
    }
    return link;
  }
}
