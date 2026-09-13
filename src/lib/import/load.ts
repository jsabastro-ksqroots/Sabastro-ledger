import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import type { DbOrTx } from "@/lib/db";
import { parseCalendarDate } from "@/lib/ledger/dates";
import { loadRefData, type RefBankAccount, type RefData } from "@/lib/ledger/ref-data";
import { simpleRowToPrimaryLine } from "@/lib/ledger/simple-row";
import { buildDesiredLines, type LineSpec, type UserLineInput } from "@/lib/ledger/transactions";
import { formatCents } from "@/lib/money";
import { isCrossEntityRow } from "./checklist";
import { SOURCE_A, SOURCE_B, type BankNumber, type EntryA, type RowB } from "./types";

/**
 * Turns extracted entries and rows into the database rows the ledger core would have written, and
 * inserts them in bulk. Workbook A lines go in exactly as written (explicit lines: no derived bank
 * side); Workbook B rows go through the same single-row → two-line rule and cross-entity bridge as a
 * hand-entered row. Every transaction carries its provenance (source file, row, Row ID, "Filled in by")
 * and a system note explaining anything the import had to decide.
 */

export interface ImportActor {
  userId: string;
  sessionId: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

export const LOCK_OVERRIDE_REASON =
  "Phase 2 historical import: loading the 2019–2024 workbook into years that are already filed";

export const ZERO_PLACEHOLDER_REASON = "zero-amount placeholder in source workbook";
export const SPLIT_PLACEHOLDER_ACCOUNT = "1313";
export const WAGES_ACCOUNT = "5226";
export const WAGES_NOTE =
  "Wages are booked at net pay, as in the 2025 books (decision D7). Gross pay and withholdings for the return come from Alison's payroll register at year end.";

export interface Lookups {
  ref: RefData;
  accountByNumber: Map<string, string>;
  classByName: Map<string, string>;
  bankByNumber: Map<BankNumber, RefBankAccount>;
  entityByCode: Map<string, string>;
}

export async function buildLookups(tx: DbOrTx): Promise<Lookups> {
  const ref = await loadRefData(tx);
  const accountByNumber = new Map([...ref.accounts.values()].map((a) => [a.number, a.id]));
  const classByName = new Map([...ref.classes.values()].map((c) => [c.name, c.id]));
  const bankByNumber = new Map<BankNumber, RefBankAccount>();
  for (const b of ref.bankAccounts.values()) bankByNumber.set(b.accountNumber as BankNumber, b);
  const entityByCode = new Map([...ref.entities.values()].map((e) => [e.code, e.id]));
  for (const code of ["SREI", "PLA"]) {
    if (!entityByCode.has(code)) throw new Error(`Entity ${code} is missing; run the seed first.`);
  }
  for (const n of ["1101", "1102", "1103", "1104"] as const) {
    if (!bankByNumber.has(n)) throw new Error(`Bank account ${n} is missing; run the seed first.`);
  }
  return { ref, accountByNumber, classByName, bankByNumber, entityByCode };
}

export interface PreparedTransaction {
  header: Prisma.TransactionCreateManyInput;
  lines: Prisma.TransactionLineCreateManyInput[];
  notes: Prisma.NoteCreateManyInput[];
  /** For the report: the source reference and whether bridge lines were generated. */
  sourceRef: string;
  bridged: boolean;
}

function requireAccount(lk: Lookups, number: string, where: string): string {
  const id = lk.accountByNumber.get(number);
  if (!id)
    throw new Error(
      `${where}: account ${number} is not in the chart of accounts. Add it in Settings → Chart of accounts (or the seed) and run the import again; nothing was written.`,
    );
  return id;
}

function requireClass(lk: Lookups, name: string, where: string): string {
  const id = lk.classByName.get(name);
  if (!id)
    throw new Error(
      `${where}: class "${name}" is not in the seed. Add it in Settings → Classes (or the seed) and run the import again; nothing was written.`,
    );
  return id;
}

function toLineRows(
  transactionId: string,
  specs: LineSpec[],
  sourceRows: (number | null)[],
): Prisma.TransactionLineCreateManyInput[] {
  return specs.map((s, i) => ({
    id: randomUUID(),
    transactionId,
    lineNo: i + 1,
    accountId: s.accountId,
    classId: s.classId,
    entityId: s.entityId,
    debitCents: s.debitCents,
    creditCents: s.creditCents,
    memo: s.memo,
    name: s.name,
    isBridge: s.isBridge,
    parentLineId: null,
    allocationModelVersionId: null,
    allocationTargetId: null,
    sourceRow: sourceRows[i] ?? null,
  }));
}

function note(
  transactionId: string,
  kind: "SYSTEM" | "USER",
  body: string,
  createdById: string | null,
  at: Date,
): Prisma.NoteCreateManyInput {
  return {
    id: randomUUID(),
    transactionId,
    kind,
    body: body.slice(0, 8000),
    createdById,
    updatedById: createdById,
    createdAt: at,
    updatedAt: at,
  };
}

const ms = (base: Date, offset: number) => new Date(base.getTime() + offset);

// ---------------------------------------------------------------------------
// Workbook A
// ---------------------------------------------------------------------------

/** The home entity of a 2019–2024 entry: its bank's entity, else the entity of its first property class, else SREI. */
function homeEntityA(lk: Lookups, entry: EntryA): string {
  if (entry.primaryBank) return (lk.bankByNumber.get(entry.primaryBank) as RefBankAccount).entityId;
  for (const l of entry.lines) {
    const cls = lk.ref.classes.get(lk.classByName.get(l.className) ?? "");
    if (cls && !cls.isShared) return cls.entityId;
  }
  return lk.entityByCode.get("SREI") as string;
}

export function prepareEntryA(
  entry: EntryA,
  lk: Lookups,
  actor: ImportActor,
  now: Date,
): PreparedTransaction {
  const id = randomUUID();
  const where = `Workbook A transaction #${entry.txn}`;
  const entityId = homeEntityA(lk, entry);
  const bank = entry.primaryBank ? lk.bankByNumber.get(entry.primaryBank) : null;
  const rows = [...entry.lines, ...entry.zeroLines].map((l) => l.row);
  const rowSpan = rows.length ? `${Math.min(...rows)}–${Math.max(...rows)}` : "—";
  const notes: Prisma.NoteCreateManyInput[] = [];
  const base = {
    id,
    entityId,
    date: parseCalendarDate(entry.date),
    vendor: entry.vendor,
    memo: entry.memo,
    kind: entry.kind,
    bankAccountId: bank?.id ?? null,
    source: "IMPORT" as const,
    sourceFile: SOURCE_A,
    sourceRef: String(entry.txn),
    sourceRef2: null,
    filledInBy: "2019–2024 workbook (Jose's books)",
    verifiedByOwner: true,
    classificationSource: "IMPORT" as const,
    flags: [] as Prisma.InputJsonValue,
    needsModelSplit: false,
    receiptExpectedCount: 0,
    createdById: actor.userId,
    updatedById: actor.userId,
    createdAt: now,
    updatedAt: now,
  };

  if (entry.isVoidPlaceholder) {
    const z = entry.zeroLines[0];
    notes.push(
      note(
        id,
        "SYSTEM",
        `Imported from the 2019–2024 workbook, transaction #${entry.txn} (sheet row${rows.length === 1 ? "" : "s"} ${rowSpan}). The workbook holds this entry with a single 0.00 line (${z?.accountLabel ?? "—"} · ${z?.className ?? "—"}${z?.name ? ` · ${z.name}` : ""}${z?.memo ? ` · ${z.memo}` : ""}), so it is kept as a voided placeholder with no lines (decision P0-3).`,
        actor.userId,
        now,
      ),
    );
    return {
      header: {
        ...base,
        status: "VOIDED",
        voidedAt: now,
        voidedById: actor.userId,
        voidReason: ZERO_PLACEHOLDER_REASON,
      },
      lines: [],
      notes,
      sourceRef: String(entry.txn),
      bridged: false,
    };
  }

  const inputs: UserLineInput[] = entry.lines.map((l) => ({
    accountId: requireAccount(lk, l.accountNumber, `${where} row ${l.row}`),
    classId: requireClass(lk, l.className, `${where} row ${l.row}`),
    debitCents: l.debitCents,
    creditCents: l.creditCents,
    memo: l.memo,
    name: l.name,
  }));
  const specs = buildDesiredLines(
    lk.ref,
    { kind: entry.kind, entityId, bankAccountId: bank?.id ?? null },
    inputs,
    { explicitLines: true },
  );
  const sourceRows = specs.map((_, i) =>
    i < entry.lines.length ? (entry.lines[i] as (typeof entry.lines)[number]).row : null,
  );

  const details: string[] = [];
  if (entry.isMerged) {
    const parts = entry.subGroups.map((g) =>
      g.touchesBank
        ? `the bank movement ${g.name ?? "(no name)"} ${formatCents(g.totalCents)} (rows ${g.firstRow}–${g.lastRow}, ${g.dates.join(" / ")})`
        : `a non-cash booking ${g.name ?? "(no name)"} ${formatCents(g.totalCents)} on ${g.accounts.join(" and ")} (rows ${g.firstRow}–${g.lastRow}, ${g.dates.join(" / ")})`,
    );
    details.push(
      `The workbook numbers two bookings as one transaction: ${parts.join("; ")}. They are kept together to match the workbook (decision P2-3); the row's vendor, date and amount are the bank movement's, and the other booking is visible in the journal lines. Ask Jose and Jamin whether to split it into two transactions.`,
    );
  } else if (entry.mixedDates) {
    const byDate = new Map<string, number[]>();
    for (const l of entry.lines) byDate.set(l.date, [...(byDate.get(l.date) ?? []), l.row]);
    details.push(
      `The workbook dates the lines differently: ${[...byDate.entries()].map(([d, rs]) => `${d} (row${rs.length === 1 ? "" : "s"} ${rs.join(", ")})`).join("; ")}. The transaction is dated ${entry.date}, the earliest of them.`,
    );
  }
  if (entry.isSelfCancelling) {
    const first = entry.lines[0];
    details.push(
      `Both lines sit on the same bank account (${first?.accountLabel ?? "the bank"}): a payment of ${formatCents(entry.lines.reduce((t, l) => t + l.debitCents, 0n))} and its reversal, net 0.00. Stored as a journal entry so both lines stay visible; the ledger shows no cash movement for it.`,
    );
  }
  for (const l of entry.lines.filter((x) => x.normalised)) {
    details.push(
      l.rawDebit < 0
        ? `Row ${l.row}: the workbook shows a debit of ${l.rawDebit.toFixed(2)} on ${l.accountLabel} (${l.className}); stored as a credit of ${formatCents(l.creditCents)} (decision P0-1).`
        : `Row ${l.row}: the workbook shows a credit of ${l.rawCredit.toFixed(2)} on ${l.accountLabel} (${l.className}); stored as a debit of ${formatCents(l.debitCents)} (decision P0-1).`,
    );
  }
  for (const z of entry.zeroLines) {
    details.push(
      `Row ${z.row}: a 0.00 line (${z.accountLabel} · ${z.className}) carries no money and was not stored.`,
    );
  }
  if (entry.bankNumbers.length > 1) {
    details.push(
      `A transfer between own bank accounts (${entry.bankNumbers.join(" and ")}); shown from ${entry.primaryBank} (decision P1-18).`,
    );
  }
  if (entry.kind !== "BANK") {
    details.push(
      entry.kind === "ADJUSTING"
        ? "No bank account is involved and the entry is a year-end or depreciation entry, so it is stored as an adjusting entry."
        : "No bank account is involved, so it is stored as a journal entry.",
    );
  }
  notes.push(
    note(
      id,
      "SYSTEM",
      `Imported from the 2019–2024 workbook, transaction #${entry.txn} (sheet rows ${rowSpan}, ${entry.lines.length} lines).${details.length ? ` ${details.join(" ")}` : ""}`,
      actor.userId,
      now,
    ),
  );

  return {
    header: { ...base, status: "POSTED", postedAt: now, postedById: actor.userId },
    lines: toLineRows(id, specs, sourceRows),
    notes,
    sourceRef: String(entry.txn),
    bridged: specs.some((s) => s.isBridge),
  };
}

// ---------------------------------------------------------------------------
// Workbook B
// ---------------------------------------------------------------------------

export interface RowBContext {
  /** Refs of the other rows in the same same-day identical group (empty when none). */
  duplicatesOf: number[];
}

export function prepareRowB(
  row: RowB,
  lk: Lookups,
  actor: ImportActor,
  now: Date,
  ctx: RowBContext,
): PreparedTransaction {
  const id = randomUUID();
  const where = `Workbook B row #${row.ref}`;
  const bank = lk.bankByNumber.get(row.bankNumber) as RefBankAccount;
  const accountNumber = row.isSplitPlaceholder
    ? SPLIT_PLACEHOLDER_ACCOUNT
    : (row.accountNumber as string);
  const accountId = requireAccount(lk, accountNumber, where);
  const classId = requireClass(lk, row.className, where);
  const primary = simpleRowToPrimaryLine({ amountCents: row.amountCents, accountId, classId });
  const specs = buildDesiredLines(
    lk.ref,
    { kind: "BANK", entityId: bank.entityId, bankAccountId: bank.id },
    [primary],
  );
  const sourceRows = specs.map((_, i) => (i === 0 ? row.row : null));
  const bridged = specs.some((s) => s.isBridge);
  const notes: Prisma.NoteCreateManyInput[] = [];
  let t = 0;

  notes.push(
    note(
      id,
      "SYSTEM",
      `Imported from the 2025 snapshot workbook, row #${row.ref}${row.rowId ? ` (Row ID ${row.rowId})` : ""}. Filled in by: ${row.filledInBy ?? "—"}${row.verifiedByOwner ? " (verified by Jose)" : ""}.${row.receipts ? ` ${row.receipts} receipt file${row.receipts === 1 ? "" : "s"} on file in the snapshot, to be uploaded in Phase 3.` : ""}`,
      actor.userId,
      ms(now, t++),
    ),
  );
  if (row.ledgerNote) notes.push(note(id, "SYSTEM", row.ledgerNote, null, ms(now, t++)));
  if (bridged) {
    const payer = lk.ref.entityCodes.get(bank.entityId) ?? "?";
    const cls = lk.ref.classes.get(classId);
    const receiver = cls ? (lk.ref.entityCodes.get(cls.entityId) ?? "?") : "?";
    notes.push(
      note(
        id,
        "SYSTEM",
        `Cross-entity row: ${payer}'s ${bank.accountNumber} ${bank.name} ${row.amountCents < 0n ? "paid for" : "received money for"} ${receiver}'s class ${row.className}. Bridge lines were added so each business balances on its own (decision D3: ${row.amountCents < 0n ? `${payer} Dr 3102 Capital Distribution / ${receiver} Cr 3101 Capital Contribution` : `${receiver} Dr 3102 / ${payer} Cr 3101`}).`,
        actor.userId,
        ms(now, t++),
      ),
    );
  }
  if (accountNumber === WAGES_ACCOUNT)
    notes.push(note(id, "SYSTEM", WAGES_NOTE, actor.userId, ms(now, t++)));
  if (ctx.duplicatesOf.length) {
    notes.push(
      note(
        id,
        "SYSTEM",
        `Same-day identical row${ctx.duplicatesOf.length === 1 ? "" : "s"} in the 2025 snapshot: snapshot row${ctx.duplicatesOf.length === 1 ? "" : "s"} ${ctx.duplicatesOf.map((n) => `#${n}`).join(", ")} (the “source row” shown under Provenance, not the ledger's own numbers) — same bank account, date and amount. Kept as a separate transaction: the 2025 review confirmed these are real, not duplicates.`,
        actor.userId,
        ms(now, t++),
      ),
    );
  }
  if (row.needsModelSplit) {
    notes.push(
      note(
        id,
        "SYSTEM",
        "Tagged “needs model split”: this row was unsplit back to a single class on 2026-09-10 pending the allocation-model system (Phase 5).",
        actor.userId,
        ms(now, t++),
      ),
    );
  }
  let flags: Prisma.InputJsonValue = [];
  if (row.isSplitPlaceholder) {
    const reason =
      "Capitalize vs expense — Jose to decide. The snapshot carried this row as “(split - varies)”: a split between 1313 Office Furniture & Equipment and 5215 Supplies Expense with no item-level detail (Questions for Jose #6). The full amount sits on 1313 until the desks and chairs are itemised.";
    flags = [{ code: "capitalize_vs_expense", reason, by: actor.userId, at: now.toISOString() }];
    notes.push(
      note(
        id,
        "SYSTEM",
        `Imported as a flagged draft, not posted. ${reason}`,
        actor.userId,
        ms(now, t++),
      ),
    );
  }
  if (row.userNote) notes.push(note(id, "USER", row.userNote, actor.userId, ms(now, t++)));

  const posted = !row.isSplitPlaceholder;
  return {
    header: {
      id,
      entityId: bank.entityId,
      date: parseCalendarDate(row.date),
      vendor: row.vendor,
      memo: row.bankDescription,
      status: posted ? "POSTED" : "FLAGGED",
      kind: "BANK",
      bankAccountId: bank.id,
      source: "IMPORT",
      sourceFile: SOURCE_B,
      sourceRef: String(row.ref),
      sourceRef2: row.rowId,
      filledInBy: row.filledInBy,
      verifiedByOwner: row.verifiedByOwner,
      classificationSource: "IMPORT",
      flags,
      needsModelSplit: row.needsModelSplit,
      receiptExpectedCount: row.receipts,
      postedAt: posted ? now : null,
      postedById: posted ? actor.userId : null,
      createdById: actor.userId,
      updatedById: actor.userId,
      createdAt: now,
      updatedAt: now,
    },
    lines: toLineRows(id, specs, sourceRows),
    notes,
    sourceRef: String(row.ref),
    bridged,
  };
}

export { isCrossEntityRow };

// ---------------------------------------------------------------------------
// Bulk insert
// ---------------------------------------------------------------------------

const HEADER_CHUNK = 500;
const LINE_CHUNK = 2000;
const NOTE_CHUNK = 2000;

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Inserts prepared transactions in order (seq follows the workbook order). Call inside one database transaction. */
export async function insertPrepared(
  tx: DbOrTx,
  prepared: PreparedTransaction[],
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  let done = 0;
  for (const batch of chunks(prepared, HEADER_CHUNK)) {
    await tx.transaction.createMany({ data: batch.map((p) => p.header) });
    const lines = batch.flatMap((p) => p.lines);
    for (const c of chunks(lines, LINE_CHUNK)) await tx.transactionLine.createMany({ data: c });
    const notes = batch.flatMap((p) => p.notes);
    for (const c of chunks(notes, NOTE_CHUNK)) await tx.note.createMany({ data: c });
    done += batch.length;
    onProgress?.(done, prepared.length);
  }
}

/** The source refs already present for a source file (the idempotency key is (source_file, source_ref)). */
export async function existingSourceRefs(tx: DbOrTx, sourceFile: string): Promise<Set<string>> {
  const rows = await tx.transaction.findMany({
    where: { sourceFile, sourceRef: { not: null } },
    select: { sourceRef: true },
  });
  return new Set(rows.map((r) => r.sourceRef as string));
}

/** Turns on the tax-year lock override for the rest of this database transaction. */
export async function setLockOverride(tx: DbOrTx, reason: string): Promise<void> {
  await tx.$executeRaw`SELECT set_config('app.lock_override_reason', ${reason}, true)`;
}
