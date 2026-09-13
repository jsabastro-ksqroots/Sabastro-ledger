import type { Prisma } from "@/generated/prisma/client";
import type { DbOrTx } from "@/lib/db";
import { audit } from "@/lib/audit";
import type { RequestMeta } from "@/lib/auth/session";
import type { Role } from "@/lib/auth/permissions";
import { formatCents } from "@/lib/money";
import { resolveLineEntity } from "./attribution";
import { computeBridgeLines } from "./bridge";
import { parseCalendarDate, toIsoDate } from "./dates";
import { LedgerError, translateLedgerDbError } from "./errors";
import { ensureTaxYears, guardLockedYears, uniquePairs, yearOf, type YearPair } from "./locks";
import { addSystemNote, setUserNote } from "./notes";
import {
  accountLabel,
  attributionContext,
  classLabel,
  loadRefData,
  type RefData,
} from "./ref-data";
import { deriveBankLines, simpleRowToPrimaryLine } from "./simple-row";
import { computeSplit, type SplitMode, type SplitPartInput } from "./split";
import { isUnposted, type TransactionSourceKey, type TransactionStatusKey } from "./types";

/**
 * The ledger core: every way a transaction is created or changed, as pure-ish functions over a Prisma
 * transaction client. Rules (docs/DESIGN.md §2–§4, DECISIONS P0-21…P0-25):
 *
 *  - Every operation runs inside ONE database transaction (`db.$transaction(tx => …)`): the balance
 *    invariants are deferred constraint triggers that fire at commit, and the tax-year override is a
 *    transaction-local setting.
 *  - Lines are never edited in place. A change computes the full set of lines the transaction should
 *    have, keeps the ones that are identical, supersedes the rest (stamped with the audit row that
 *    replaced them) and inserts the new ones. This holds for drafts too, so there is one code path.
 *  - For a bank-centric transaction the bank lines (one per class, opposite side) and the cross-entity
 *    bridge lines are derived from the user's lines and regenerated on every change; users edit only
 *    the "user lines" (the account/class side).
 *  - Every write first runs the tax-year lock guard, then writes the audit row, then the data.
 */

export type Actor = { userId: string; sessionId: string | null; role?: Role } & RequestMeta;

export interface WriteOptions {
  /** Typed by the user after the full-screen warning; required when a closed/filed year is touched. */
  lockOverrideReason?: string | null;
}

export interface LineSpec {
  accountId: string | null;
  classId: string | null;
  entityId: string | null;
  debitCents: bigint;
  creditCents: bigint;
  memo: string | null;
  name: string | null;
  isBridge: boolean;
  parentLineId: string | null;
  allocationModelVersionId: string | null;
  allocationTargetId: string | null;
}

/** What a user provides for one line (entity, bank and bridge lines are derived). */
export interface UserLineInput {
  accountId: string | null;
  classId: string | null;
  debitCents: bigint;
  creditCents: bigint;
  memo?: string | null;
  name?: string | null;
  parentLineId?: string | null;
  allocationModelVersionId?: string | null;
  allocationTargetId?: string | null;
}

const transactionInclude = {
  lines: { orderBy: { lineNo: "asc" as const } },
  bankAccount: { include: { account: { select: { number: true, name: true } } } },
  entity: { select: { id: true, code: true, name: true } },
} satisfies Prisma.TransactionInclude;

export type LoadedTransaction = Prisma.TransactionGetPayload<{
  include: typeof transactionInclude;
}>;
export type LoadedLine = LoadedTransaction["lines"][number];

export async function loadTransaction(tx: DbOrTx, id: string): Promise<LoadedTransaction> {
  const t = await tx.transaction.findUnique({ where: { id }, include: transactionInclude });
  if (!t) throw new LedgerError("That transaction no longer exists.");
  return t;
}

export function liveLines(t: { lines: LoadedLine[] }): LoadedLine[] {
  return t.lines.filter((l) => l.supersededAt === null);
}

/** Bank lines of a bank-centric transaction and bridge lines are derived; everything else is a user line. */
export function isDerivedLine(
  ref: RefData,
  t: { kind: string },
  line: { isBridge: boolean; accountId: string | null },
): boolean {
  if (line.isBridge) return true;
  return t.kind === "BANK" && !!line.accountId && ref.bankByAccountId.has(line.accountId);
}

export function userLinesOf(ref: RefData, t: LoadedTransaction): LoadedLine[] {
  return liveLines(t).filter((l) => !isDerivedLine(ref, t, l));
}

export function transactionLabel(t: { seq: bigint; vendor: string | null }): string {
  return `#${t.seq} ${t.vendor ?? ""}`.trim();
}

// ---------------------------------------------------------------------------
// Validation and line building
// ---------------------------------------------------------------------------

function cleanText(value: string | null | undefined, max: number, label: string): string | null {
  const s = (value ?? "").trim();
  if (!s) return null;
  if (s.length > max) throw new LedgerError(`${label} must be ${max} characters or fewer.`);
  return s;
}

function requireAccount(ref: RefData, accountId: string | null, label: string, required: boolean) {
  if (!accountId) {
    if (required) throw new LedgerError(`${label}: pick an account.`);
    return null;
  }
  const a = ref.accounts.get(accountId);
  if (!a) throw new LedgerError(`${label}: that account does not exist.`);
  if (!a.isActive) throw new LedgerError(`${label}: ${a.number} ${a.name} is inactive.`);
  return a;
}

function requireClass(ref: RefData, classId: string | null, label: string, required: boolean) {
  if (!classId) {
    if (required) throw new LedgerError(`${label}: pick a class.`);
    return null;
  }
  const c = ref.classes.get(classId);
  if (!c) throw new LedgerError(`${label}: that class does not exist.`);
  if (!c.isActive) throw new LedgerError(`${label}: the class “${c.name}” is inactive.`);
  return c;
}

function validateUserLines(
  ref: RefData,
  inputs: readonly UserLineInput[],
  opts: { requireComplete: boolean; bankLedgerAccountId?: string | null },
): void {
  inputs.forEach((l, i) => {
    const label = `Line ${i + 1}`;
    requireAccount(ref, l.accountId, label, opts.requireComplete);
    requireClass(ref, l.classId, label, opts.requireComplete);
    if (l.debitCents < 0n || l.creditCents < 0n)
      throw new LedgerError(`${label}: amounts cannot be negative.`);
    if (l.debitCents > 0n === l.creditCents > 0n)
      throw new LedgerError(`${label}: enter either a debit or a credit, greater than zero.`);
    if (opts.bankLedgerAccountId && l.accountId === opts.bankLedgerAccountId)
      throw new LedgerError(
        `${label}: that is the bank account this transaction already runs through. Pick the account the money went to (or came from).`,
      );
  });
}

/**
 * The full set of lines a transaction should have: the user's lines (attributed to their entities), the
 * derived bank lines for a bank-centric transaction, and the cross-entity bridge lines.
 */
export function buildDesiredLines(
  ref: RefData,
  head: { kind: string; entityId: string; bankAccountId: string | null },
  inputs: readonly UserLineInput[],
): LineSpec[] {
  const ctx = attributionContext(ref, head.entityId);
  const user: LineSpec[] = inputs.map((l) => ({
    accountId: l.accountId,
    classId: l.classId,
    entityId: resolveLineEntity({ accountId: l.accountId, classId: l.classId }, ctx),
    debitCents: l.debitCents,
    creditCents: l.creditCents,
    memo: l.memo ?? null,
    name: l.name ?? null,
    isBridge: false,
    parentLineId: l.parentLineId ?? null,
    allocationModelVersionId: l.allocationModelVersionId ?? null,
    allocationTargetId: l.allocationTargetId ?? null,
  }));

  const derived: LineSpec[] = [];
  if (head.kind === "BANK") {
    const bank = head.bankAccountId ? ref.bankAccounts.get(head.bankAccountId) : null;
    if (!bank) throw new LedgerError("Pick the bank account this transaction ran through.");
    for (const b of deriveBankLines(user, bank.accountId)) {
      derived.push({
        accountId: b.accountId,
        classId: b.classId,
        entityId: bank.entityId,
        debitCents: b.debitCents,
        creditCents: b.creditCents,
        memo: null,
        name: null,
        isBridge: false,
        parentLineId: null,
        allocationModelVersionId: null,
        allocationTargetId: null,
      });
    }
  } else {
    let dr = 0n;
    let cr = 0n;
    for (const l of user) {
      dr += l.debitCents;
      cr += l.creditCents;
    }
    if (dr !== cr)
      throw new LedgerError(
        `The entry does not balance: debits ${formatCents(dr)} vs credits ${formatCents(cr)} (difference ${formatCents(dr - cr)}).`,
      );
  }

  const base = [...user, ...derived];
  const bridge = computeBridgeLines(
    base.map((l) => ({
      entityId: l.entityId as string,
      classId: l.classId,
      debitCents: l.debitCents,
      creditCents: l.creditCents,
      isBridge: false,
    })),
    {
      rules: ref.rules,
      generalClassId: ref.generalClassId,
      defaultPayerAccountId: ref.defaultPayerAccountId,
      defaultReceiverAccountId: ref.defaultReceiverAccountId,
      entityCodes: ref.entityCodes,
    },
  ).map<LineSpec>((b) => ({
    accountId: b.accountId,
    classId: b.classId,
    entityId: b.entityId,
    debitCents: b.debitCents,
    creditCents: b.creditCents,
    memo: b.memo,
    name: null,
    isBridge: true,
    parentLineId: null,
    allocationModelVersionId: null,
    allocationTargetId: null,
  }));
  return [...base, ...bridge];
}

function lineKey(l: LineSpec | LoadedLine): string {
  return [
    l.accountId ?? "",
    l.classId ?? "",
    l.entityId ?? "",
    l.debitCents.toString(),
    l.creditCents.toString(),
    l.memo ?? "",
    l.name ?? "",
    l.isBridge ? "1" : "0",
    l.parentLineId ?? "",
    l.allocationModelVersionId ?? "",
    l.allocationTargetId ?? "",
  ].join("|");
}

/**
 * Makes the live lines equal to `desired`: identical lines are kept (same id), the rest are superseded
 * with the audit row's id, missing ones are inserted. Returns what changed.
 */
async function replaceLiveLines(
  tx: DbOrTx,
  t: LoadedTransaction,
  desired: LineSpec[],
  auditId: bigint,
): Promise<{ superseded: number; inserted: number }> {
  const pool = new Map<string, LoadedLine[]>();
  for (const l of liveLines(t)) {
    const k = lineKey(l);
    const arr = pool.get(k) ?? [];
    arr.push(l);
    pool.set(k, arr);
  }
  const toInsert: LineSpec[] = [];
  for (const spec of desired) {
    const arr = pool.get(lineKey(spec));
    if (arr && arr.length > 0) arr.shift();
    else toInsert.push(spec);
  }
  const toSupersede = [...pool.values()].flat();
  if (toSupersede.length > 0) {
    await tx.transactionLine.updateMany({
      where: { id: { in: toSupersede.map((l) => l.id) } },
      data: { supersededAt: new Date(), supersededByAuditId: auditId },
    });
  }
  if (toInsert.length > 0) {
    let lineNo = t.lines.reduce((m, l) => Math.max(m, l.lineNo), 0) + 1;
    await tx.transactionLine.createMany({
      data: toInsert.map((s) => ({ transactionId: t.id, lineNo: lineNo++, ...s })),
    });
  }
  return { superseded: toSupersede.length, inserted: toInsert.length };
}

// ---------------------------------------------------------------------------
// Snapshots (for the audit log) and lock pairs
// ---------------------------------------------------------------------------

export function snapshotTransaction(ref: RefData, t: LoadedTransaction) {
  const lines = liveLines(t);
  return {
    seq: t.seq.toString(),
    entity: ref.entityCodes.get(t.entityId) ?? t.entityId,
    date: toIsoDate(t.date),
    vendor: t.vendor,
    memo: t.memo,
    status: t.status,
    kind: t.kind,
    bankAccount: t.bankAccount ? `${t.bankAccount.account.number} ${t.bankAccount.name}` : null,
    lines: lines.map((l) => ({
      lineNo: l.lineNo,
      account: accountLabel(ref, l.accountId),
      class: classLabel(ref, l.classId),
      entity: l.entityId ? (ref.entityCodes.get(l.entityId) ?? l.entityId) : null,
      debit: l.debitCents.toString(),
      credit: l.creditCents.toString(),
      memo: l.memo,
      isBridge: l.isBridge,
      parentLineNo: l.parentLineId
        ? (t.lines.find((p) => p.id === l.parentLineId)?.lineNo ?? null)
        : null,
    })),
  };
}

/** The same shape as snapshotTransaction, computed before the write from the lines the transaction will have. */
export function snapshotDesired(
  ref: RefData,
  head: NextHeader & { seq: bigint },
  t: LoadedTransaction,
  desired: LineSpec[],
) {
  const bank = head.bankAccountId ? ref.bankAccounts.get(head.bankAccountId) : null;
  return {
    seq: head.seq.toString(),
    entity: ref.entityCodes.get(head.entityId) ?? head.entityId,
    date: toIsoDate(head.date),
    vendor: head.vendor,
    memo: head.memo,
    status: head.status,
    kind: head.kind,
    bankAccount: bank ? `${bank.accountNumber} ${bank.name}` : null,
    lines: desired.map((l) => ({
      account: accountLabel(ref, l.accountId),
      class: classLabel(ref, l.classId),
      entity: l.entityId ? (ref.entityCodes.get(l.entityId) ?? l.entityId) : null,
      debit: l.debitCents.toString(),
      credit: l.creditCents.toString(),
      memo: l.memo,
      isBridge: l.isBridge,
      parentLineNo: l.parentLineId
        ? (t.lines.find((p) => p.id === l.parentLineId)?.lineNo ?? null)
        : null,
    })),
  };
}

export interface NextHeader {
  date: Date;
  vendor: string | null;
  memo: string | null;
  entityId: string;
  bankAccountId: string | null;
  kind: "BANK" | "JOURNAL" | "ADJUSTING";
  status: "DRAFT" | "FLAGGED" | "POSTED" | "VOIDED";
}

function headerOf(t: LoadedTransaction): NextHeader {
  return {
    date: t.date,
    vendor: t.vendor,
    memo: t.memo,
    entityId: t.entityId,
    bankAccountId: t.bankAccountId,
    kind: t.kind,
    status: t.status,
  };
}

function pairsOf(entityIds: Iterable<string | null>, years: Iterable<number>): YearPair[] {
  const out: YearPair[] = [];
  const ys = [...new Set(years)];
  for (const e of new Set(entityIds)) {
    if (!e) continue;
    for (const y of ys) out.push({ entityId: e, year: y });
  }
  return uniquePairs(out);
}

/**
 * Runs the lock guard for a change to an existing transaction. Drafts and flagged rows that stay
 * unposted are never locked; anything touching a posted/voided state checks every entity involved
 * before and after, for the old and the new date.
 */
async function guardChange(
  tx: DbOrTx,
  actor: Actor,
  t: LoadedTransaction,
  next: { entityId: string; lineEntities: (string | null)[]; date: Date; status: string },
  action: string,
  opts: WriteOptions,
) {
  const stays =
    isUnposted(t.status as TransactionStatusKey) && isUnposted(next.status as TransactionStatusKey);
  const pairs = pairsOf(
    [t.entityId, ...liveLines(t).map((l) => l.entityId), next.entityId, ...next.lineEntities],
    [yearOf(t.date), yearOf(next.date)],
  );
  await ensureTaxYears(tx, pairs);
  if (stays) return [];
  return guardLockedYears(
    tx,
    actor,
    pairs,
    { action, subjectType: "transaction", subjectId: t.id, subjectLabel: transactionLabel(t) },
    opts.lockOverrideReason,
  );
}

function actorFields(actor: Actor) {
  return {
    userId: actor.userId,
    sessionId: actor.sessionId,
    ip: actor.ip ?? null,
    userAgent: actor.userAgent ?? null,
  };
}

async function runGuarded<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    return translateLedgerDbError(err);
  }
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export interface CreateBankTransactionInput {
  bankAccountId: string;
  date: string;
  vendor: string;
  memo?: string | null;
  /** Signed cents: negative = money out of the bank. */
  amountCents: bigint;
  accountId: string;
  classId: string;
  userNote?: string | null;
  post: boolean;
  source?: TransactionSourceKey;
  classificationSource?: "IMPORT" | "VENDOR_HISTORY" | "AI" | "HUMAN";
  filledInBy?: string | null;
}

export async function createBankTransaction(
  tx: DbOrTx,
  actor: Actor,
  input: CreateBankTransactionInput,
  opts: WriteOptions = {},
): Promise<LoadedTransaction> {
  const ref = await loadRefData(tx);
  const bank = ref.bankAccounts.get(input.bankAccountId);
  if (!bank) throw new LedgerError("Pick the bank account this transaction ran through.");
  if (!bank.isActive)
    throw new LedgerError(
      `${bank.accountNumber} ${bank.name} is inactive; pick an active bank account.`,
    );
  const date = parseCalendarDate(input.date);
  const vendor = cleanText(input.vendor, 200, "Vendor");
  if (!vendor) throw new LedgerError("Enter the vendor or payee.");
  const memo = cleanText(input.memo, 2000, "Memo");
  const primary = simpleRowToPrimaryLine({
    amountCents: input.amountCents,
    accountId: input.accountId,
    classId: input.classId,
  });
  validateUserLines(ref, [primary], { requireComplete: true, bankLedgerAccountId: bank.accountId });
  const status: TransactionStatusKey = input.post ? "POSTED" : "DRAFT";
  const head = { kind: "BANK", entityId: bank.entityId, bankAccountId: bank.id };
  const desired = buildDesiredLines(ref, head, [primary]);
  const label = `${vendor} ${formatCents(input.amountCents, { symbol: true })}`;

  const pairs = pairsOf([bank.entityId, ...desired.map((l) => l.entityId)], [yearOf(date)]);
  await ensureTaxYears(tx, pairs);
  if (status === "POSTED") {
    await guardLockedYears(
      tx,
      actor,
      pairs,
      { action: "transaction.create", subjectType: "transaction", subjectLabel: label },
      opts.lockOverrideReason,
    );
  }

  return runGuarded(async () => {
    const now = new Date();
    const created = await tx.transaction.create({
      data: {
        entityId: bank.entityId,
        date,
        vendor,
        memo,
        status,
        kind: "BANK",
        bankAccountId: bank.id,
        source: input.source ?? "MANUAL",
        classificationSource: input.classificationSource ?? "HUMAN",
        filledInBy: input.filledInBy ?? null,
        postedAt: status === "POSTED" ? now : null,
        postedById: status === "POSTED" ? actor.userId : null,
        createdById: actor.userId,
        updatedById: actor.userId,
        lines: {
          create: desired.map((s, i) => ({ lineNo: i + 1, ...s })),
        },
      },
      include: transactionInclude,
    });
    await audit(tx, {
      action: "transaction.create",
      ...actorFields(actor),
      subjectType: "transaction",
      subjectId: created.id,
      subjectLabel: transactionLabel(created),
      entityId: created.entityId,
      after: snapshotTransaction(ref, created),
    });
    await addSystemNote(
      tx,
      created.id,
      `${status === "POSTED" ? "Entered and posted" : "Entered as a draft"} by hand.`,
      actor.userId,
    );
    if (input.userNote?.trim()) await setUserNote(tx, actor, created.id, input.userNote);
    return loadTransaction(tx, created.id);
  });
}

export interface CreateJournalEntryInput {
  entityId: string;
  date: string;
  vendor: string;
  memo?: string | null;
  adjusting: boolean;
  lines: UserLineInput[];
  userNote?: string | null;
  post: boolean;
  source?: TransactionSourceKey;
}

export async function createJournalEntry(
  tx: DbOrTx,
  actor: Actor,
  input: CreateJournalEntryInput,
  opts: WriteOptions = {},
): Promise<LoadedTransaction> {
  const ref = await loadRefData(tx);
  const entity = ref.entities.get(input.entityId);
  if (!entity) throw new LedgerError("Pick the business this entry belongs to.");
  if (!entity.isActive) throw new LedgerError(`${entity.code} is inactive.`);
  const date = parseCalendarDate(input.date);
  const vendor = cleanText(input.vendor, 200, "Description");
  if (!vendor) throw new LedgerError("Give the entry a short description (who or what it is for).");
  const memo = cleanText(input.memo, 2000, "Memo");
  if (input.lines.length < 2) throw new LedgerError("A journal entry needs at least two lines.");
  const lines = input.lines.map((l) => ({
    ...l,
    memo: cleanText(l.memo, 500, "Line memo"),
    parentLineId: null,
  }));
  validateUserLines(ref, lines, { requireComplete: input.post });
  const kind = input.adjusting ? "ADJUSTING" : "JOURNAL";
  const status: TransactionStatusKey = input.post ? "POSTED" : "DRAFT";
  const desired = buildDesiredLines(ref, { kind, entityId: entity.id, bankAccountId: null }, lines);

  const pairs = pairsOf([entity.id, ...desired.map((l) => l.entityId)], [yearOf(date)]);
  await ensureTaxYears(tx, pairs);
  if (status === "POSTED") {
    await guardLockedYears(
      tx,
      actor,
      pairs,
      { action: "transaction.create", subjectType: "transaction", subjectLabel: vendor },
      opts.lockOverrideReason,
    );
  }

  return runGuarded(async () => {
    const now = new Date();
    const created = await tx.transaction.create({
      data: {
        entityId: entity.id,
        date,
        vendor,
        memo,
        status,
        kind,
        source: input.source ?? "MANUAL",
        classificationSource: "HUMAN",
        postedAt: status === "POSTED" ? now : null,
        postedById: status === "POSTED" ? actor.userId : null,
        createdById: actor.userId,
        updatedById: actor.userId,
        lines: { create: desired.map((s, i) => ({ lineNo: i + 1, ...s })) },
      },
      include: transactionInclude,
    });
    await audit(tx, {
      action: "transaction.create",
      ...actorFields(actor),
      subjectType: "transaction",
      subjectId: created.id,
      subjectLabel: transactionLabel(created),
      entityId: created.entityId,
      after: snapshotTransaction(ref, created),
    });
    await addSystemNote(
      tx,
      created.id,
      `${input.adjusting ? "Adjusting entry" : "Journal entry"} ${status === "POSTED" ? "entered and posted" : "entered as a draft"} by hand.`,
      actor.userId,
    );
    if (input.userNote?.trim()) await setUserNote(tx, actor, created.id, input.userNote);
    return loadTransaction(tx, created.id);
  });
}

// ---------------------------------------------------------------------------
// Edit
// ---------------------------------------------------------------------------

function assertEditable(t: LoadedTransaction): void {
  if (t.status === "VOIDED")
    throw new LedgerError(
      "This transaction is voided and cannot be changed. Enter a new one instead.",
    );
}

/**
 * Shared tail of every edit: lock guard, one audit row (before/after computed up front), header
 * update, line replacement stamped with that audit row, optional system note, reload.
 */
async function applyEdit(
  tx: DbOrTx,
  actor: Actor,
  ref: RefData,
  t: LoadedTransaction,
  action: string,
  next: { header: NextHeader; desired: LineSpec[] },
  opts: WriteOptions,
  extra: { reason?: string | null; note?: string | null } = {},
): Promise<LoadedTransaction> {
  await guardChange(
    tx,
    actor,
    t,
    {
      entityId: next.header.entityId,
      lineEntities: next.desired.map((l) => l.entityId),
      date: next.header.date,
      status: next.header.status,
    },
    action,
    opts,
  );
  return runGuarded(async () => {
    const before = snapshotTransaction(ref, t);
    const after = snapshotDesired(ref, { ...next.header, seq: t.seq }, t, next.desired);
    const auditId = await audit(tx, {
      action,
      ...actorFields(actor),
      subjectType: "transaction",
      subjectId: t.id,
      subjectLabel: transactionLabel(t),
      entityId: t.entityId,
      before,
      after,
      reason: extra.reason ?? null,
    });
    const h = next.header;
    await tx.transaction.update({
      where: { id: t.id },
      data: {
        date: h.date,
        vendor: h.vendor,
        memo: h.memo,
        kind: h.kind,
        entityId: h.entityId,
        bankAccountId: h.bankAccountId,
        updatedById: actor.userId,
      },
    });
    await replaceLiveLines(tx, t, next.desired, auditId);
    if (extra.note) await addSystemNote(tx, t.id, extra.note, actor.userId);
    return loadTransaction(tx, t.id);
  });
}

export interface UpdateBankTransactionInput {
  date?: string;
  vendor?: string;
  memo?: string | null;
  bankAccountId?: string;
  amountCents?: bigint;
  accountId?: string;
  classId?: string;
}

/**
 * Edits the simple row. Amount, account and class can only change while the transaction has a single
 * user line; a split transaction is edited line by line (or unsplit first).
 */
export async function updateBankTransaction(
  tx: DbOrTx,
  actor: Actor,
  id: string,
  input: UpdateBankTransactionInput,
  opts: WriteOptions = {},
): Promise<LoadedTransaction> {
  const ref = await loadRefData(tx);
  const t = await loadTransaction(tx, id);
  assertEditable(t);
  if (t.kind !== "BANK")
    throw new LedgerError("This is a journal entry; edit it with the journal editor.");
  const bank = ref.bankAccounts.get(input.bankAccountId ?? t.bankAccountId ?? "");
  if (!bank) throw new LedgerError("Pick the bank account this transaction ran through.");
  if (input.bankAccountId && input.bankAccountId !== t.bankAccountId && !bank.isActive)
    throw new LedgerError(
      `${bank.accountNumber} ${bank.name} is inactive; pick an active bank account.`,
    );

  const current = userLinesOf(ref, t);
  const wantsRowChange =
    input.amountCents !== undefined || input.accountId !== undefined || input.classId !== undefined;
  if (wantsRowChange && current.length !== 1)
    throw new LedgerError(
      `This transaction is split into ${current.length} lines. Edit the lines one by one, or unsplit it first.`,
    );

  let userLines: UserLineInput[];
  if (wantsRowChange) {
    const only = current[0] as LoadedLine;
    const currentAmount = only.debitCents > 0n ? -only.debitCents : only.creditCents;
    const primary = simpleRowToPrimaryLine({
      amountCents: input.amountCents ?? currentAmount,
      accountId: input.accountId ?? (only.accountId as string),
      classId: input.classId ?? (only.classId as string),
      memo: only.memo,
    });
    userLines = [{ ...primary, parentLineId: only.parentLineId }];
  } else {
    userLines = current.map((l) => ({
      accountId: l.accountId,
      classId: l.classId,
      debitCents: l.debitCents,
      creditCents: l.creditCents,
      memo: l.memo,
      name: l.name,
      parentLineId: l.parentLineId,
      allocationModelVersionId: l.allocationModelVersionId,
      allocationTargetId: l.allocationTargetId,
    }));
  }
  validateUserLines(ref, userLines, {
    requireComplete: t.status === "POSTED",
    bankLedgerAccountId: bank.accountId,
  });

  const date = input.date === undefined ? t.date : parseCalendarDate(input.date);
  const vendor = input.vendor === undefined ? t.vendor : cleanText(input.vendor, 200, "Vendor");
  if (!vendor) throw new LedgerError("Enter the vendor or payee.");
  const memo = input.memo === undefined ? t.memo : cleanText(input.memo, 2000, "Memo");
  const desired = buildDesiredLines(
    ref,
    { kind: "BANK", entityId: bank.entityId, bankAccountId: bank.id },
    userLines,
  );
  return applyEdit(
    tx,
    actor,
    ref,
    t,
    "transaction.update",
    {
      header: {
        ...headerOf(t),
        date,
        vendor,
        memo,
        entityId: bank.entityId,
        bankAccountId: bank.id,
      },
      desired,
    },
    opts,
  );
}

export interface UpdateJournalEntryInput {
  date?: string;
  vendor?: string;
  memo?: string | null;
  entityId?: string;
  adjusting?: boolean;
  lines?: UserLineInput[];
}

export async function updateJournalEntry(
  tx: DbOrTx,
  actor: Actor,
  id: string,
  input: UpdateJournalEntryInput,
  opts: WriteOptions = {},
): Promise<LoadedTransaction> {
  const ref = await loadRefData(tx);
  const t = await loadTransaction(tx, id);
  assertEditable(t);
  if (t.kind === "BANK")
    throw new LedgerError("This is a bank transaction; edit it as a simple row.");
  const entity = ref.entities.get(input.entityId ?? t.entityId);
  if (!entity || !entity.isActive) throw new LedgerError("Pick an active business for this entry.");
  const date = input.date === undefined ? t.date : parseCalendarDate(input.date);
  const vendor =
    input.vendor === undefined ? t.vendor : cleanText(input.vendor, 200, "Description");
  if (!vendor) throw new LedgerError("Give the entry a short description.");
  const memo = input.memo === undefined ? t.memo : cleanText(input.memo, 2000, "Memo");
  const kind = input.adjusting === undefined ? t.kind : input.adjusting ? "ADJUSTING" : "JOURNAL";
  const userLines: UserLineInput[] = input.lines
    ? input.lines.map((l) => ({
        ...l,
        memo: cleanText(l.memo, 500, "Line memo"),
        parentLineId: null,
      }))
    : userLinesOf(ref, t).map((l) => ({
        accountId: l.accountId,
        classId: l.classId,
        debitCents: l.debitCents,
        creditCents: l.creditCents,
        memo: l.memo,
        name: l.name,
        parentLineId: l.parentLineId,
        allocationModelVersionId: l.allocationModelVersionId,
        allocationTargetId: l.allocationTargetId,
      }));
  if (userLines.length < 2) throw new LedgerError("A journal entry needs at least two lines.");
  validateUserLines(ref, userLines, { requireComplete: t.status === "POSTED" });
  const desired = buildDesiredLines(
    ref,
    { kind, entityId: entity.id, bankAccountId: null },
    userLines,
  );
  return applyEdit(
    tx,
    actor,
    ref,
    t,
    "transaction.update",
    {
      header: { ...headerOf(t), date, vendor, memo, kind, entityId: entity.id },
      desired,
    },
    opts,
  );
}

/** Inline edit of one user line's account and/or class (the ledger grid's inline editor). */
export async function setLineAccountClass(
  tx: DbOrTx,
  actor: Actor,
  lineId: string,
  patch: { accountId?: string; classId?: string },
  opts: WriteOptions = {},
): Promise<LoadedTransaction> {
  const ref = await loadRefData(tx);
  const line = await tx.transactionLine.findUnique({ where: { id: lineId } });
  if (!line) throw new LedgerError("That line no longer exists.");
  const t = await loadTransaction(tx, line.transactionId);
  assertEditable(t);
  if (line.supersededAt)
    throw new LedgerError("That line has already been replaced; reload the page.");
  if (isDerivedLine(ref, t, line))
    throw new LedgerError(
      line.isBridge
        ? "Bridge lines are generated automatically and cannot be edited."
        : "The bank line follows the other lines; edit the account/class line instead.",
    );
  const bank = t.bankAccountId ? ref.bankAccounts.get(t.bankAccountId) : null;
  const userLines: UserLineInput[] = userLinesOf(ref, t).map((l) => ({
    accountId: l.id === line.id ? (patch.accountId ?? l.accountId) : l.accountId,
    classId: l.id === line.id ? (patch.classId ?? l.classId) : l.classId,
    debitCents: l.debitCents,
    creditCents: l.creditCents,
    memo: l.memo,
    name: l.name,
    parentLineId: l.parentLineId,
    allocationModelVersionId: l.allocationModelVersionId,
    allocationTargetId: l.allocationTargetId,
  }));
  validateUserLines(ref, userLines, {
    requireComplete: t.status === "POSTED",
    bankLedgerAccountId: bank?.accountId ?? null,
  });
  const desired = buildDesiredLines(
    ref,
    { kind: t.kind, entityId: t.entityId, bankAccountId: t.bankAccountId },
    userLines,
  );
  const before = `${accountLabel(ref, line.accountId)} · ${classLabel(ref, line.classId)}`;
  const after = `${accountLabel(ref, patch.accountId ?? line.accountId)} · ${classLabel(ref, patch.classId ?? line.classId)}`;
  return applyEdit(
    tx,
    actor,
    ref,
    t,
    "transaction.line_edit",
    { header: headerOf(t), desired },
    opts,
    { note: `Line ${line.lineNo} changed from ${before} to ${after}.` },
  );
}

// ---------------------------------------------------------------------------
// Split / unsplit
// ---------------------------------------------------------------------------

export async function splitLine(
  tx: DbOrTx,
  actor: Actor,
  lineId: string,
  parts: SplitPartInput[],
  mode: SplitMode,
  opts: WriteOptions = {},
): Promise<LoadedTransaction> {
  const ref = await loadRefData(tx);
  const line = await tx.transactionLine.findUnique({ where: { id: lineId } });
  if (!line) throw new LedgerError("That line no longer exists.");
  const t = await loadTransaction(tx, line.transactionId);
  assertEditable(t);
  if (line.supersededAt)
    throw new LedgerError("That line has already been replaced; reload the page.");
  if (isDerivedLine(ref, t, line))
    throw new LedgerError("Only the account/class side of a transaction can be split.");
  const magnitude = line.debitCents > 0n ? line.debitCents : line.creditCents;
  const side = line.debitCents > 0n ? "debit" : "credit";
  const computed = computeSplit(magnitude, parts, mode);
  const bank = t.bankAccountId ? ref.bankAccounts.get(t.bankAccountId) : null;
  const children: UserLineInput[] = computed.map((p) => ({
    accountId: p.accountId,
    classId: p.classId,
    debitCents: side === "debit" ? p.amountCents : 0n,
    creditCents: side === "credit" ? p.amountCents : 0n,
    memo: p.memo,
    name: line.name,
    parentLineId: line.id,
  }));
  const others: UserLineInput[] = userLinesOf(ref, t)
    .filter((l) => l.id !== line.id)
    .map((l) => ({
      accountId: l.accountId,
      classId: l.classId,
      debitCents: l.debitCents,
      creditCents: l.creditCents,
      memo: l.memo,
      name: l.name,
      parentLineId: l.parentLineId,
      allocationModelVersionId: l.allocationModelVersionId,
      allocationTargetId: l.allocationTargetId,
    }));
  const userLines = [...others, ...children];
  validateUserLines(ref, userLines, {
    requireComplete: t.status === "POSTED",
    bankLedgerAccountId: bank?.accountId ?? null,
  });
  const desired = buildDesiredLines(
    ref,
    { kind: t.kind, entityId: t.entityId, bankAccountId: t.bankAccountId },
    userLines,
  );
  return applyEdit(tx, actor, ref, t, "transaction.split", { header: headerOf(t), desired }, opts, {
    note: `Line ${line.lineNo} (${accountLabel(ref, line.accountId)} · ${classLabel(ref, line.classId)}, ${formatCents(magnitude)}) split into ${computed.length} lines: ${computed
      .map((p) => `${classLabel(ref, p.classId)} ${formatCents(p.amountCents)}`)
      .join(", ")}.`,
  });
}

/** Live user lines that descend from `parentLineId` (children, grandchildren, …). */
export function descendantsOf(t: LoadedTransaction, parentLineId: string): LoadedLine[] {
  const byId = new Map(t.lines.map((l) => [l.id, l]));
  const isDescendant = (l: LoadedLine): boolean => {
    let cur = l.parentLineId ? byId.get(l.parentLineId) : undefined;
    while (cur) {
      if (cur.id === parentLineId) return true;
      cur = cur.parentLineId ? byId.get(cur.parentLineId) : undefined;
    }
    return false;
  };
  return liveLines(t).filter(isDescendant);
}

/** The topmost ancestor of a split line (the line the transaction had before any split). */
export function splitRootOf(t: LoadedTransaction, line: LoadedLine): LoadedLine {
  const byId = new Map(t.lines.map((l) => [l.id, l]));
  let cur = line;
  while (cur.parentLineId) {
    const p = byId.get(cur.parentLineId);
    if (!p) break;
    cur = p;
  }
  return cur;
}

/**
 * Collapses every live line under `parentLineId` back into one line with the parent's amount, on the
 * account and class chosen (defaults to the first child's). The parent stays superseded; the new line
 * points at it, so the history is a chain: original → children → single line again.
 */
export async function unsplitLine(
  tx: DbOrTx,
  actor: Actor,
  parentLineId: string,
  target: { accountId?: string | null; classId?: string | null } = {},
  opts: WriteOptions = {},
): Promise<LoadedTransaction> {
  const ref = await loadRefData(tx);
  const parent = await tx.transactionLine.findUnique({ where: { id: parentLineId } });
  if (!parent) throw new LedgerError("That line no longer exists.");
  const t = await loadTransaction(tx, parent.transactionId);
  assertEditable(t);
  if (!parent.supersededAt) throw new LedgerError("That line is not split.");
  const children = descendantsOf(t, parent.id);
  if (children.length === 0) throw new LedgerError("That line is not split any more.");
  const first = children[0] as LoadedLine;
  const accountId = target.accountId ?? first.accountId;
  const classId = target.classId ?? first.classId;
  const bank = t.bankAccountId ? ref.bankAccounts.get(t.bankAccountId) : null;
  const childIds = new Set(children.map((c) => c.id));
  const others: UserLineInput[] = userLinesOf(ref, t)
    .filter((l) => !childIds.has(l.id))
    .map((l) => ({
      accountId: l.accountId,
      classId: l.classId,
      debitCents: l.debitCents,
      creditCents: l.creditCents,
      memo: l.memo,
      name: l.name,
      parentLineId: l.parentLineId,
      allocationModelVersionId: l.allocationModelVersionId,
      allocationTargetId: l.allocationTargetId,
    }));
  const single: UserLineInput = {
    accountId,
    classId,
    debitCents: parent.debitCents,
    creditCents: parent.creditCents,
    memo: parent.memo,
    name: parent.name,
    parentLineId: parent.id,
  };
  const userLines = [...others, single];
  validateUserLines(ref, userLines, {
    requireComplete: t.status === "POSTED",
    bankLedgerAccountId: bank?.accountId ?? null,
  });
  const desired = buildDesiredLines(
    ref,
    { kind: t.kind, entityId: t.entityId, bankAccountId: t.bankAccountId },
    userLines,
  );
  return applyEdit(
    tx,
    actor,
    ref,
    t,
    "transaction.unsplit",
    { header: headerOf(t), desired },
    opts,
    {
      note: `${children.length} split lines collapsed back into one line: ${accountLabel(ref, accountId)} · ${classLabel(ref, classId)} ${formatCents(parent.debitCents > 0n ? parent.debitCents : parent.creditCents)}.`,
    },
  );
}

// ---------------------------------------------------------------------------
// Status changes: post, void, flag
// ---------------------------------------------------------------------------

export async function postTransaction(
  tx: DbOrTx,
  actor: Actor,
  id: string,
  opts: WriteOptions = {},
): Promise<LoadedTransaction> {
  const ref = await loadRefData(tx);
  const t = await loadTransaction(tx, id);
  if (t.status === "POSTED") return t;
  if (t.status === "VOIDED") throw new LedgerError("A voided transaction cannot be posted.");
  const live = liveLines(t);
  const incomplete = live.filter((l) => !l.accountId || !l.classId || !l.entityId);
  if (incomplete.length)
    throw new LedgerError(
      `Line${incomplete.length === 1 ? "" : "s"} ${incomplete.map((l) => l.lineNo).join(", ")} still need${incomplete.length === 1 ? "s" : ""} an account and a class.`,
    );
  await guardChange(
    tx,
    actor,
    t,
    {
      entityId: t.entityId,
      lineEntities: live.map((l) => l.entityId),
      date: t.date,
      status: "POSTED",
    },
    "transaction.post",
    opts,
  );
  return runGuarded(async () => {
    const before = snapshotTransaction(ref, t);
    await tx.transaction.update({
      where: { id },
      data: {
        status: "POSTED",
        postedAt: new Date(),
        postedById: actor.userId,
        updatedById: actor.userId,
      },
    });
    const after = await loadTransaction(tx, id);
    await audit(tx, {
      action: "transaction.post",
      ...actorFields(actor),
      subjectType: "transaction",
      subjectId: id,
      subjectLabel: transactionLabel(t),
      entityId: t.entityId,
      before,
      after: snapshotTransaction(ref, after),
    });
    await addSystemNote(tx, id, "Confirmed and posted.", actor.userId);
    return after;
  });
}

export async function voidTransaction(
  tx: DbOrTx,
  actor: Actor,
  id: string,
  reason: string,
  opts: WriteOptions = {},
): Promise<LoadedTransaction> {
  const ref = await loadRefData(tx);
  const t = await loadTransaction(tx, id);
  if (t.status === "VOIDED") throw new LedgerError("This transaction is already voided.");
  const cleaned = reason.trim();
  if (cleaned.length < 3) throw new LedgerError("Give a reason for voiding this transaction.");
  if (cleaned.length > 1000)
    throw new LedgerError("The reason is too long (1,000 characters at most).");
  await guardChange(
    tx,
    actor,
    t,
    {
      entityId: t.entityId,
      lineEntities: liveLines(t).map((l) => l.entityId),
      date: t.date,
      status: "VOIDED",
    },
    "transaction.void",
    opts,
  );
  return runGuarded(async () => {
    const before = snapshotTransaction(ref, t);
    await tx.transaction.update({
      where: { id },
      data: {
        status: "VOIDED",
        voidedAt: new Date(),
        voidedById: actor.userId,
        voidReason: cleaned,
        updatedById: actor.userId,
      },
    });
    const after = await loadTransaction(tx, id);
    await audit(tx, {
      action: "transaction.void",
      ...actorFields(actor),
      subjectType: "transaction",
      subjectId: id,
      subjectLabel: transactionLabel(t),
      entityId: t.entityId,
      before,
      after: snapshotTransaction(ref, after),
      reason: cleaned,
    });
    await addSystemNote(tx, id, `Voided: ${cleaned}`, actor.userId);
    return after;
  });
}

/** Marks a draft as flagged (needs a human decision) or clears the flag. Never touches posted rows. */
export async function setFlag(
  tx: DbOrTx,
  actor: Actor,
  id: string,
  flagged: boolean,
  reason: string | null = null,
): Promise<LoadedTransaction> {
  const t = await loadTransaction(tx, id);
  if (!isUnposted(t.status as TransactionStatusKey))
    throw new LedgerError("Only drafts can be flagged or unflagged.");
  const cleaned = (reason ?? "").trim();
  if (flagged && cleaned.length < 3) throw new LedgerError("Say why this needs a second look.");
  const flags = Array.isArray(t.flags) ? (t.flags as unknown[]) : [];
  const nextFlags = flagged
    ? [
        ...flags,
        { code: "manual", reason: cleaned, by: actor.userId, at: new Date().toISOString() },
      ]
    : [];
  return runGuarded(async () => {
    await tx.transaction.update({
      where: { id },
      data: {
        status: flagged ? "FLAGGED" : "DRAFT",
        flags: nextFlags as Prisma.InputJsonValue,
        updatedById: actor.userId,
      },
    });
    await audit(tx, {
      action: flagged ? "transaction.flag" : "transaction.unflag",
      ...actorFields(actor),
      subjectType: "transaction",
      subjectId: id,
      subjectLabel: transactionLabel(t),
      entityId: t.entityId,
      before: { status: t.status, flags },
      after: { status: flagged ? "FLAGGED" : "DRAFT", flags: nextFlags },
      reason: flagged ? cleaned : null,
    });
    if (flagged) await addSystemNote(tx, id, `Flagged: ${cleaned}`, actor.userId);
    return loadTransaction(tx, id);
  });
}
