import type { DbOrTx } from "@/lib/db";
import { audit } from "@/lib/audit";
import type { RequestMeta } from "@/lib/auth/session";
import { LockedYearError, type LockedYear } from "./errors";

/**
 * The tax-year lock from the application side (docs/DESIGN.md §4, DECISIONS P0-22).
 *
 * The database trigger is the real gate: it refuses any write that touches a posted or voided
 * transaction in a CLOSED or FILED year unless the current database transaction has set
 * `app.lock_override_reason`. This module (1) finds the locked years before a write so the UI can show
 * the full-screen warning with the right names, and (2) applies an override: sets the reason for the
 * rest of the database transaction, writes one audit row per locked year with is_lock_override = true,
 * and bumps each year's override_count.
 */

export type LockActor = { userId: string; sessionId: string | null } & RequestMeta;

export interface YearPair {
  entityId: string;
  year: number;
}

export function yearOf(date: Date): number {
  return date.getUTCFullYear();
}

export function uniquePairs(pairs: Iterable<YearPair>): YearPair[] {
  const seen = new Map<string, YearPair>();
  for (const p of pairs) seen.set(`${p.entityId}:${p.year}`, p);
  return [...seen.values()];
}

/** The CLOSED / FILED tax years among the given (entity, year) pairs. */
export async function findLockedYears(tx: DbOrTx, pairs: YearPair[]): Promise<LockedYear[]> {
  const wanted = uniquePairs(pairs);
  if (wanted.length === 0) return [];
  const rows = await tx.taxYear.findMany({
    where: {
      state: { in: ["CLOSED", "FILED"] },
      OR: wanted.map((p) => ({ entityId: p.entityId, year: p.year })),
    },
    include: { entity: { select: { code: true } } },
    orderBy: [{ year: "asc" }, { entity: { code: "asc" } }],
  });
  return rows.map((r) => ({
    taxYearId: r.id,
    entityId: r.entityId,
    entityCode: r.entity.code,
    year: r.year,
    state: r.state as "CLOSED" | "FILED",
    overrideCount: r.overrideCount,
  }));
}

/** Creates the OPEN tax-year rows that do not exist yet (a year with no row counts as open). */
export async function ensureTaxYears(tx: DbOrTx, pairs: YearPair[]): Promise<void> {
  for (const p of uniquePairs(pairs)) {
    const existing = await tx.taxYear.findUnique({
      where: { entityId_year: { entityId: p.entityId, year: p.year } },
      select: { id: true },
    });
    if (!existing) {
      await tx.taxYear.create({ data: { entityId: p.entityId, year: p.year, state: "OPEN" } });
    }
  }
}

export interface OverrideSubject {
  action: string;
  subjectType: string;
  subjectId?: string;
  subjectLabel?: string;
}

/**
 * Turns on the override for the rest of this database transaction. Must be called after the user typed
 * a reason. One audit row per locked year, each marked as an override, and override_count + 1.
 */
export async function applyLockOverride(
  tx: DbOrTx,
  actor: LockActor,
  locked: LockedYear[],
  reason: string,
  subject: OverrideSubject,
): Promise<void> {
  const cleaned = reason.trim();
  if (cleaned.length < 5)
    throw new Error("An override reason of at least five characters is required.");
  await tx.$executeRaw`SELECT set_config('app.lock_override_reason', ${cleaned}, true)`;
  for (const y of locked) {
    await tx.taxYear.update({
      where: { id: y.taxYearId },
      data: { overrideCount: { increment: 1 } },
    });
    await audit(tx, {
      action: "tax_year.override",
      userId: actor.userId,
      sessionId: actor.sessionId,
      subjectType: subject.subjectType,
      subjectId: subject.subjectId,
      subjectLabel: subject.subjectLabel,
      entityId: y.entityId,
      taxYearId: y.taxYearId,
      reason: cleaned,
      isLockOverride: true,
      after: {
        year: y.year,
        state: y.state,
        overrideCount: y.overrideCount + 1,
        overriddenAction: subject.action,
      },
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
  }
}

/**
 * The guard every ledger write runs before touching a posted row: throws LockedYearError (so the UI can
 * ask for a reason) when a locked year is involved and no reason was given; applies the override when it
 * was. Returns the locked years (empty when nothing was locked).
 */
export async function guardLockedYears(
  tx: DbOrTx,
  actor: LockActor,
  pairs: YearPair[],
  subject: OverrideSubject,
  overrideReason: string | null | undefined,
): Promise<LockedYear[]> {
  const locked = await findLockedYears(tx, pairs);
  if (locked.length === 0) return [];
  if (!overrideReason || overrideReason.trim().length === 0) throw new LockedYearError(locked);
  await applyLockOverride(tx, actor, locked, overrideReason, subject);
  return locked;
}
