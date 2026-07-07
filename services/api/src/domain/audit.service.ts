import { AuditLog, NurseryStore } from "./types.js";
import { createDomainId } from "./id.js";

export class AuditService {
  constructor(private readonly store: NurseryStore) {}

  record(input: Omit<AuditLog, "id" | "createdAt">): AuditLog {
    const log: AuditLog = {
      ...input,
      id: createDomainId("audit"),
      createdAt: new Date()
    };
    this.store.auditLogs.push(log);
    return log;
  }
}
