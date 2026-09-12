import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { DbOrTx } from "@/lib/db";

/**
 * The Activity tab: read-only queries over `audit_log`, the filter grammar shared by the page and the
 * CSV export route, and the CSV writer. Pure functions over a Prisma client so they are testable
 * without Next.js.
 */

export const ACTIVITY_PAGE_SIZE = 50;
export const ACTIVITY_MAX_PAGE_SIZE = 200;
export const ACTIVITY_EXPORT_MAX_ROWS = 10_000;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-01-31");

/** Every filter is optional; an empty string means "not set" so a plain GET form round-trips cleanly. */
export const activityFilterSchema = z.object({
  userId: z.string().uuid().optional(),
  action: z.string().trim().min(1).max(200).optional(),
  actionPrefix: z.string().trim().min(1).max(200).optional(),
  entityId: z.string().uuid().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  text: z.string().trim().min(1).max(200).optional(),
  isLockOverride: z.boolean().optional(),
});

export type ActivityFilters = z.infer<typeof activityFilterSchema>;

type RawParams = Record<string, string | string[] | undefined> | URLSearchParams;

function firstValue(params: RawParams, key: string): string | undefined {
  const v = params instanceof URLSearchParams ? params.get(key) : params[key];
  if (Array.isArray(v)) return v[0];
  return v ?? undefined;
}

/**
 * Turns URL search params into validated filters. Anything blank or malformed is simply dropped
 * (the page never errors because of a bad link). Also returns the page number.
 */
export function parseActivityParams(params: RawParams): {
  filters: ActivityFilters;
  page: number;
  pageSize: number;
} {
  const candidate: Record<string, unknown> = {};
  for (const key of [
    "userId",
    "action",
    "actionPrefix",
    "entityId",
    "from",
    "to",
    "text",
  ] as const) {
    const v = firstValue(params, key);
    if (v !== undefined && v.trim() !== "") candidate[key] = v;
  }
  const override = firstValue(params, "overridesOnly") ?? firstValue(params, "isLockOverride");
  if (override === "1" || override === "true" || override === "on") candidate.isLockOverride = true;

  const filters: ActivityFilters = {};
  const shape = activityFilterSchema.shape;
  for (const key of Object.keys(shape) as (keyof ActivityFilters)[]) {
    if (candidate[key] === undefined) continue;
    const parsed = shape[key].safeParse(candidate[key]);
    if (parsed.success) (filters as Record<string, unknown>)[key] = parsed.data;
  }
  // A "from" after a "to" is almost certainly a typo; ignore both rather than return nothing.
  if (filters.from && filters.to && filters.from > filters.to) {
    delete filters.from;
    delete filters.to;
  }

  const pageRaw = Number(firstValue(params, "page") ?? "1");
  const page = Number.isInteger(pageRaw) && pageRaw >= 1 ? pageRaw : 1;
  const sizeRaw = Number(firstValue(params, "pageSize") ?? String(ACTIVITY_PAGE_SIZE));
  const pageSize =
    Number.isInteger(sizeRaw) && sizeRaw >= 1
      ? Math.min(sizeRaw, ACTIVITY_MAX_PAGE_SIZE)
      : ACTIVITY_PAGE_SIZE;
  return { filters, page, pageSize };
}

/** The reverse: filters back into query-string form, so links and the export button carry them. */
export function activityFiltersToParams(
  filters: ActivityFilters,
  extra: Record<string, string | number | undefined> = {},
): URLSearchParams {
  const sp = new URLSearchParams();
  if (filters.userId) sp.set("userId", filters.userId);
  if (filters.action) sp.set("action", filters.action);
  if (filters.actionPrefix) sp.set("actionPrefix", filters.actionPrefix);
  if (filters.entityId) sp.set("entityId", filters.entityId);
  if (filters.from) sp.set("from", filters.from);
  if (filters.to) sp.set("to", filters.to);
  if (filters.text) sp.set("text", filters.text);
  if (filters.isLockOverride) sp.set("overridesOnly", "1");
  for (const [k, v] of Object.entries(extra)) {
    if (v !== undefined && v !== "") sp.set(k, String(v));
  }
  return sp;
}

/** Calendar-date bounds: "from" starts at local midnight, "to" is inclusive (ends before the next midnight). */
function dateBounds(from?: string, to?: string): Prisma.DateTimeFilter | undefined {
  if (!from && !to) return undefined;
  const bounds: Prisma.DateTimeFilter = {};
  if (from) bounds.gte = new Date(`${from}T00:00:00`);
  if (to) {
    const end = new Date(`${to}T00:00:00`);
    end.setDate(end.getDate() + 1);
    bounds.lt = end;
  }
  return bounds;
}

export function buildAuditWhere(filters: ActivityFilters): Prisma.AuditLogWhereInput {
  const where: Prisma.AuditLogWhereInput = {};
  if (filters.userId) where.userId = filters.userId;
  if (filters.action) where.action = filters.action;
  else if (filters.actionPrefix) where.action = { startsWith: filters.actionPrefix };
  if (filters.entityId) where.entityId = filters.entityId;
  const at = dateBounds(filters.from, filters.to);
  if (at) where.at = at;
  if (filters.isLockOverride) where.isLockOverride = true;
  if (filters.text) {
    const contains = { contains: filters.text, mode: "insensitive" as const };
    where.OR = [{ subjectLabel: contains }, { reason: contains }, { action: contains }];
  }
  return where;
}

export interface AuditRow {
  id: bigint;
  at: Date;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  sessionId: string | null;
  action: string;
  subjectType: string | null;
  subjectId: string | null;
  subjectLabel: string | null;
  entityId: string | null;
  entityCode: string | null;
  taxYearId: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  isLockOverride: boolean;
  ip: string | null;
  userAgent: string | null;
}

type RawAuditRow = Prisma.AuditLogGetPayload<{
  include: { user: { select: { displayName: true; email: true } } };
}>;

async function entityCodeMap(tx: DbOrTx, ids: (string | null)[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((x): x is string => !!x))];
  if (wanted.length === 0) return new Map();
  const entities = await tx.entity.findMany({
    where: { id: { in: wanted } },
    select: { id: true, code: true },
  });
  return new Map(entities.map((e) => [e.id, e.code]));
}

function toAuditRow(r: RawAuditRow, codes: Map<string, string>): AuditRow {
  return {
    id: r.id,
    at: r.at,
    userId: r.userId,
    userName: r.user?.displayName ?? null,
    userEmail: r.user?.email ?? null,
    sessionId: r.sessionId,
    action: r.action,
    subjectType: r.subjectType,
    subjectId: r.subjectId,
    subjectLabel: r.subjectLabel,
    entityId: r.entityId,
    entityCode: r.entityId ? (codes.get(r.entityId) ?? null) : null,
    taxYearId: r.taxYearId,
    before: r.before ?? null,
    after: r.after ?? null,
    reason: r.reason,
    isLockOverride: r.isLockOverride,
    ip: r.ip,
    userAgent: r.userAgent,
  };
}

export interface AuditPage {
  rows: AuditRow[];
  total: number;
  page: number;
  pageSize: number;
}

/** Newest first. `page` is 1-based; `pageSize` is capped at ACTIVITY_MAX_PAGE_SIZE. */
export async function queryAuditLog(
  tx: DbOrTx,
  filters: ActivityFilters,
  paging: { page?: number; pageSize?: number } = {},
): Promise<AuditPage> {
  const page = Math.max(1, Math.floor(paging.page ?? 1));
  const pageSize = Math.min(
    ACTIVITY_MAX_PAGE_SIZE,
    Math.max(1, Math.floor(paging.pageSize ?? ACTIVITY_PAGE_SIZE)),
  );
  const where = buildAuditWhere(filters);
  const [total, raw] = await Promise.all([
    tx.auditLog.count({ where }),
    tx.auditLog.findMany({
      where,
      orderBy: [{ at: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { user: { select: { displayName: true, email: true } } },
    }),
  ]);
  const codes = await entityCodeMap(
    tx,
    raw.map((r) => r.entityId),
  );
  return { rows: raw.map((r) => toAuditRow(r, codes)), total, page, pageSize };
}

/** Every distinct action name that has ever been logged, A→Z, for the action dropdown. */
export async function listAuditActions(tx: DbOrTx): Promise<string[]> {
  const rows = await tx.auditLog.findMany({
    distinct: ["action"],
    select: { action: true },
    orderBy: { action: "asc" },
  });
  return rows.map((r) => r.action);
}

/** Users who appear in the log at least once (active or not), by display name. */
export async function listAuditUsers(
  tx: DbOrTx,
): Promise<{ id: string; displayName: string; email: string; isActive: boolean }[]> {
  const ids = await tx.auditLog.findMany({
    distinct: ["userId"],
    select: { userId: true },
    where: { userId: { not: null } },
  });
  const wanted = ids.map((r) => r.userId).filter((x): x is string => !!x);
  if (wanted.length === 0) return [];
  return tx.user.findMany({
    where: { id: { in: wanted } },
    select: { id: true, displayName: true, email: true, isActive: true },
    orderBy: [{ displayName: "asc" }],
  });
}

/**
 * Walks the filtered log newest-first in batches (keyset on id, so it stays cheap on a big table),
 * stopping at `max` rows. Used by the CSV export so nothing large is held in memory at once.
 */
export async function* iterateAuditLog(
  tx: DbOrTx,
  filters: ActivityFilters,
  opts: { max?: number; batch?: number } = {},
): AsyncGenerator<AuditRow[]> {
  const max = Math.min(ACTIVITY_EXPORT_MAX_ROWS, Math.max(1, opts.max ?? ACTIVITY_EXPORT_MAX_ROWS));
  const batch = Math.max(1, Math.min(1000, opts.batch ?? 500));
  const base = buildAuditWhere(filters);
  let sent = 0;
  let cursor: bigint | null = null;
  while (sent < max) {
    const where: Prisma.AuditLogWhereInput =
      cursor === null ? base : { AND: [base, { id: { lt: cursor } }] };
    const raw = await tx.auditLog.findMany({
      where,
      orderBy: { id: "desc" },
      take: Math.min(batch, max - sent),
      include: { user: { select: { displayName: true, email: true } } },
    });
    if (raw.length === 0) return;
    const codes = await entityCodeMap(
      tx,
      raw.map((r) => r.entityId),
    );
    const rows = raw.map((r) => toAuditRow(r, codes));
    sent += rows.length;
    cursor = raw[raw.length - 1]!.id;
    yield rows;
    if (raw.length < batch) return;
  }
}

// ---------- CSV ----------

export const ACTIVITY_CSV_COLUMNS = [
  "id",
  "at",
  "user",
  "user_email",
  "action",
  "subject_type",
  "subject_id",
  "subject_label",
  "entity",
  "tax_year_id",
  "reason",
  "lock_override",
  "before_field_count",
  "after_field_count",
  "ip",
  "user_agent",
  "session_id",
] as const;

export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = typeof value === "string" ? value : String(value);
  // Neutralise spreadsheet formula injection (=, +, -, @ at the start) and quote when needed.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function fieldCount(value: unknown): number | "" {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.length;
  if (typeof value === "object") return Object.keys(value as object).length;
  return 1;
}

export function auditRowToCsv(row: AuditRow): string {
  const cells: unknown[] = [
    row.id.toString(),
    row.at.toISOString(),
    row.userId ? (row.userName ?? row.userEmail ?? row.userId) : "system",
    row.userEmail ?? "",
    row.action,
    row.subjectType,
    row.subjectId,
    row.subjectLabel,
    row.entityCode ?? row.entityId,
    row.taxYearId,
    row.reason,
    row.isLockOverride ? "yes" : "no",
    fieldCount(row.before),
    fieldCount(row.after),
    row.ip,
    row.userAgent,
    row.sessionId,
  ];
  return cells.map(csvEscape).join(",") + "\r\n";
}

export function auditCsvHeader(): string {
  return ACTIVITY_CSV_COLUMNS.join(",") + "\r\n";
}

/** A plain-English one-liner of the active filters, for the audit row and the page. */
export function describeFilters(
  filters: ActivityFilters,
  names: { user?: string | null; entity?: string | null } = {},
): string {
  const parts: string[] = [];
  if (filters.userId) parts.push(`user ${names.user ?? filters.userId}`);
  if (filters.action) parts.push(`action "${filters.action}"`);
  else if (filters.actionPrefix) parts.push(`actions starting "${filters.actionPrefix}"`);
  if (filters.entityId) parts.push(`entity ${names.entity ?? filters.entityId}`);
  if (filters.from && filters.to) parts.push(`${filters.from} to ${filters.to}`);
  else if (filters.from) parts.push(`from ${filters.from}`);
  else if (filters.to) parts.push(`up to ${filters.to}`);
  if (filters.text) parts.push(`containing "${filters.text}"`);
  if (filters.isLockOverride) parts.push("overrides only");
  return parts.length ? parts.join(", ") : "no filters";
}
