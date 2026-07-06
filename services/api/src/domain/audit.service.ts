import { AuditLog, NurseryStore } from "./types.js";

let auditCounter = 0;

export class AuditService {
  constructor(private readonly store: NurseryStore) {}

  record(input: Omit<AuditLog, "id" | "createdAt">): AuditLog {
    const log: AuditLog = {
      ...input,
      id: `audit-${++auditCounter}`,
      createdAt: new Date()
    };
    this.store.auditLogs.push(log);
    return log;
  }
}
