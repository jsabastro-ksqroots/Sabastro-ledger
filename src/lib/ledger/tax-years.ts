import type { DbOrTx } from "@/lib/db";
import { audit } from "@/lib/audit";
import type { RequestMeta } from "@/lib/auth/session";
import { LedgerError } from "./errors";

/**
 * Tax years per entity: open → closed → filed (docs/DESIGN.md §4). Closing is gated by the year-end
 * checklist; each item is satisfied automatically (when the app can tell), ticked by a person, or
 * overridden with a typed reason. Re-opening is Owner-only and is itself an audited lock override.
 */

export type YearActor = { userId: string; sessionId: string | null } & RequestMeta;

export interface ChecklistDefinition {
  key: string;
  label: string;
  description: string;
  /** Which phase makes the automatic check real; until then the item is ticked by hand or overridden. */
  phase: string | null;
}

export const CHECKLIST_ITEMS: ChecklistDefinition[] = [
  {
    key: "no_drafts",
    label: "No drafts or flagged items dated in this year",
    description:
      "Every transaction dated in the year is posted or voided. Checked automatically from the ledger.",
    phase: null,
  },
  {
    key: "bank_reconciled",
    label: "Every bank month reconciled to its statement",
    description:
      "The ledger balance of each bank account matches the statement at every month end. Automatic once statements are in the app (Phase 4); tick it by hand until then.",
    phase: "Phase 4",
  },
  {
    key: "model_applied",
    label: "Allocation model applied to the year's shared costs",
    description:
      "General-class costs that the year's model splits across properties have been split. Automatic once models exist (Phase 5).",
    phase: "Phase 5",
  },
  {
    key: "adjusting_entries",
    label: "Year-end adjusting entries booked",
    description:
      "Depreciation from TurboTax's schedule, security-deposit movements and capitalisation reclassifications are entered as adjusting entries. Satisfied automatically when at least one posted adjusting entry is dated in the year.",
    phase: null,
  },
  {
    key: "export_generated",
    label: "Tax export generated",
    description:
      "The Excel file for the return has been produced from the closed numbers. Automatic in Phase 6; tick it by hand until then.",
    phase: "Phase 6",
  },
];

export type ChecklistState = "auto" | "done" | "overridden" | "open";

export interface ChecklistStatus extends ChecklistDefinition {
  state: ChecklistState;
  detail: string;
  doneAt: Date | null;
  doneById: string | null;
  overrideReason: string | null;
}

export interface YearCounts {
  posted: number;
  draft: number;
  flagged: number;
  voided: number;
  adjusting: number;
}

const yearRange = (year: number) => ({
  gte: new Date(Date.UTC(year, 0, 1)),
  lt: new Date(Date.UTC(year + 1, 0, 1)),
});

/** Transactions of an entity dated in a year, counted by status (lines attributed to the entity count too). */
export async function countYear(tx: DbOrTx, entityId: string, year: number): Promise<YearCounts> {
  const where = (status: "POSTED" | "DRAFT" | "FLAGGED" | "VOIDED") => ({
    status,
    date: yearRange(year),
    OR: [{ entityId }, { lines: { some: { entityId, supersededAt: null } } }],
  });
  const [posted, draft, flagged, voided, adjusting] = await Promise.all([
    tx.transaction.count({ where: where("POSTED") }),
    tx.transaction.count({ where: where("DRAFT") }),
    tx.transaction.count({ where: where("FLAGGED") }),
    tx.transaction.count({ where: where("VOIDED") }),
    tx.transaction.count({ where: { ...where("POSTED"), kind: "ADJUSTING" } }),
  ]);
  return { posted, draft, flagged, voided, adjusting };
}

export async function getChecklist(
  tx: DbOrTx,
  taxYear: { id: string; entityId: string; year: number },
): Promise<{ items: ChecklistStatus[]; counts: YearCounts; canClose: boolean }> {
  const [rows, counts] = await Promise.all([
    tx.taxYearChecklistItem.findMany({ where: { taxYearId: taxYear.id } }),
    countYear(tx, taxYear.entityId, taxYear.year),
  ]);
  const byKey = new Map(rows.map((r) => [r.itemKey, r]));
  const items: ChecklistStatus[] = CHECKLIST_ITEMS.map((def) => {
    const row = byKey.get(def.key);
    let auto: { ok: boolean; detail: string } | null = null;
    if (def.key === "no_drafts") {
      const open = counts.draft + counts.flagged;
      auto = {
        ok: open === 0,
        detail:
          open === 0
            ? `${counts.posted} posted, none open.`
            : `${counts.draft} draft${counts.draft === 1 ? "" : "s"} and ${counts.flagged} flagged still open.`,
      };
    } else if (def.key === "adjusting_entries") {
      auto = {
        ok: counts.adjusting > 0,
        detail:
          counts.adjusting > 0
            ? `${counts.adjusting} posted adjusting entr${counts.adjusting === 1 ? "y" : "ies"} dated in the year.`
            : "No posted adjusting entry dated in the year yet.",
      };
    }
    if (auto?.ok) {
      return {
        ...def,
        state: "auto",
        detail: auto.detail,
        doneAt: null,
        doneById: null,
        overrideReason: null,
      };
    }
    if (row?.overrideReason) {
      return {
        ...def,
        state: "overridden",
        detail: auto?.detail ?? "Overridden with a reason.",
        doneAt: row.doneAt,
        doneById: row.doneById,
        overrideReason: row.overrideReason,
      };
    }
    if (row?.doneAt) {
      return {
        ...def,
        state: "done",
        detail: auto?.detail ?? "Ticked by hand.",
        doneAt: row.doneAt,
        doneById: row.doneById,
        overrideReason: null,
      };
    }
    return {
      ...def,
      state: "open",
      detail:
        auto?.detail ?? (def.phase ? `Automatic check arrives in ${def.phase}.` : "Not done yet."),
      doneAt: null,
      doneById: null,
      overrideReason: null,
    };
  });
  return { items, counts, canClose: items.every((i) => i.state !== "open") };
}

async function loadYear(tx: DbOrTx, taxYearId: string) {
  const y = await tx.taxYear.findUnique({
    where: { id: taxYearId },
    include: { entity: { select: { id: true, code: true } } },
  });
  if (!y) throw new LedgerError("That tax year no longer exists.");
  return y;
}

function actorFields(actor: YearActor) {
  return {
    userId: actor.userId,
    sessionId: actor.sessionId,
    ip: actor.ip ?? null,
    userAgent: actor.userAgent ?? null,
  };
}

/** Ticks, un-ticks or overrides one checklist item. Overriding always needs a reason. */
export async function setChecklistItem(
  tx: DbOrTx,
  actor: YearActor,
  taxYearId: string,
  itemKey: string,
  change: { done: boolean; overrideReason?: string | null },
) {
  const def = CHECKLIST_ITEMS.find((i) => i.key === itemKey);
  if (!def) throw new LedgerError("Unknown checklist item.");
  const year = await loadYear(tx, taxYearId);
  const reason = (change.overrideReason ?? "").trim();
  if (reason && reason.length < 5)
    throw new LedgerError("Give a reason of at least five characters.");
  if (reason.length > 1000)
    throw new LedgerError("The reason is too long (1,000 characters at most).");
  const before = await tx.taxYearChecklistItem.findUnique({
    where: { taxYearId_itemKey: { taxYearId, itemKey } },
  });
  const data = {
    doneAt: change.done || reason ? new Date() : null,
    doneById: change.done || reason ? actor.userId : null,
    overrideReason: reason || null,
  };
  const row = await tx.taxYearChecklistItem.upsert({
    where: { taxYearId_itemKey: { taxYearId, itemKey } },
    create: { taxYearId, itemKey, ...data },
    update: data,
  });
  await audit(tx, {
    action: reason
      ? "tax_year.checklist_override"
      : change.done
        ? "tax_year.checklist_done"
        : "tax_year.checklist_undone",
    ...actorFields(actor),
    subjectType: "tax_year",
    subjectId: taxYearId,
    subjectLabel: `${year.entity.code} ${year.year} · ${def.label}`,
    entityId: year.entityId,
    taxYearId,
    before: before
      ? { doneAt: before.doneAt, overrideReason: before.overrideReason }
      : { doneAt: null, overrideReason: null },
    after: { doneAt: row.doneAt, overrideReason: row.overrideReason },
    reason: reason || null,
  });
  return row;
}

/** OPEN → CLOSED, gated by the checklist. */
export async function closeTaxYear(
  tx: DbOrTx,
  actor: YearActor,
  taxYearId: string,
  note?: string | null,
) {
  const year = await loadYear(tx, taxYearId);
  if (year.state !== "OPEN")
    throw new LedgerError(
      `${year.entity.code} ${year.year} is already ${year.state.toLowerCase()}.`,
    );
  const { items, canClose } = await getChecklist(tx, year);
  if (!canClose) {
    const open = items.filter((i) => i.state === "open").map((i) => i.label);
    throw new LedgerError(`The year-end checklist is not complete: ${open.join("; ")}.`);
  }
  const after = await tx.taxYear.update({
    where: { id: taxYearId },
    data: {
      state: "CLOSED",
      closedAt: new Date(),
      closedById: actor.userId,
      note: note?.trim() ? note.trim().slice(0, 1000) : year.note,
    },
  });
  await audit(tx, {
    action: "tax_year.close",
    ...actorFields(actor),
    subjectType: "tax_year",
    subjectId: taxYearId,
    subjectLabel: `${year.entity.code} ${year.year}`,
    entityId: year.entityId,
    taxYearId,
    before: { state: year.state },
    after: { state: after.state, checklist: items.map((i) => ({ key: i.key, state: i.state })) },
  });
  return after;
}

/** CLOSED → FILED. The filed return PDF is attached in Phase 6 (History area). */
export async function fileTaxYear(
  tx: DbOrTx,
  actor: YearActor,
  taxYearId: string,
  note?: string | null,
) {
  const year = await loadYear(tx, taxYearId);
  if (year.state === "FILED")
    throw new LedgerError(`${year.entity.code} ${year.year} is already filed.`);
  if (year.state !== "CLOSED") throw new LedgerError("Close the year before marking it filed.");
  const after = await tx.taxYear.update({
    where: { id: taxYearId },
    data: {
      state: "FILED",
      filedAt: new Date(),
      filedById: actor.userId,
      note: note?.trim() ? note.trim().slice(0, 1000) : year.note,
    },
  });
  await audit(tx, {
    action: "tax_year.file",
    ...actorFields(actor),
    subjectType: "tax_year",
    subjectId: taxYearId,
    subjectLabel: `${year.entity.code} ${year.year}`,
    entityId: year.entityId,
    taxYearId,
    before: { state: year.state },
    after: { state: after.state },
  });
  return after;
}

/**
 * CLOSED/FILED → OPEN. Owner-only (checked by the caller); an audited lock override that keeps the
 * override count and any attached documents. Re-closing runs the checklist again.
 */
export async function reopenTaxYear(
  tx: DbOrTx,
  actor: YearActor,
  taxYearId: string,
  reason: string,
) {
  const year = await loadYear(tx, taxYearId);
  if (year.state === "OPEN")
    throw new LedgerError(`${year.entity.code} ${year.year} is already open.`);
  const cleaned = reason.trim();
  if (cleaned.length < 5)
    throw new LedgerError("Give a reason of at least five characters for re-opening the year.");
  await tx.$executeRaw`SELECT set_config('app.lock_override_reason', ${cleaned}, true)`;
  const after = await tx.taxYear.update({
    where: { id: taxYearId },
    data: { state: "OPEN", overrideCount: { increment: 1 } },
  });
  await audit(tx, {
    action: "tax_year.reopen",
    ...actorFields(actor),
    subjectType: "tax_year",
    subjectId: taxYearId,
    subjectLabel: `${year.entity.code} ${year.year}`,
    entityId: year.entityId,
    taxYearId,
    before: { state: year.state, overrideCount: year.overrideCount },
    after: { state: after.state, overrideCount: after.overrideCount },
    reason: cleaned,
    isLockOverride: true,
  });
  return after;
}
