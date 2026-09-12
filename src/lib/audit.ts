import type { DbOrTx } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

export interface AuditEntry {
  action: string;
  userId?: string | null;
  sessionId?: string | null;
  subjectType?: string;
  subjectId?: string;
  subjectLabel?: string;
  entityId?: string | null;
  taxYearId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  isLockOverride?: boolean;
  ip?: string | null;
  userAgent?: string | null;
}

const SECRET_KEY = /password|secret|token|hash|recovery|cookie|apikey|api_key/i;

/** Removes anything that looks like a credential before it is written to the audit log. */
export function scrub(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  if (typeof value === "object") {
    if (depth > 6) return "[nested]";
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY.test(k) ? "[redacted]" : scrub(v, depth + 1);
    }
    return out;
  }
  return value;
}

/** Appends one row to the audit log. Call inside the same transaction as the change it describes. */
export async function audit(tx: DbOrTx, entry: AuditEntry): Promise<void> {
  await tx.auditLog.create({
    data: {
      action: entry.action,
      userId: entry.userId ?? null,
      sessionId: entry.sessionId ?? null,
      subjectType: entry.subjectType ?? null,
      subjectId: entry.subjectId ?? null,
      subjectLabel: entry.subjectLabel ?? null,
      entityId: entry.entityId ?? null,
      taxYearId: entry.taxYearId ?? null,
      before:
        entry.before === undefined ? undefined : (scrub(entry.before) as Prisma.InputJsonValue),
      after: entry.after === undefined ? undefined : (scrub(entry.after) as Prisma.InputJsonValue),
      reason: entry.reason ?? null,
      isLockOverride: entry.isLockOverride ?? false,
      ip: entry.ip ?? null,
      userAgent: entry.userAgent ? entry.userAgent.slice(0, 500) : null,
    },
  });
}
