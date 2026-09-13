import type { Prisma } from "@/generated/prisma/client";
import type { DbOrTx } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { toIsoDate } from "./dates";
import { bankAmount, totalDebits } from "./simple-row";
import { loadRefData, type RefData } from "./ref-data";
import { isDerivedLine } from "./transactions";

/**
 * Read side of the ledger. Everything returned here is plain JSON (cents as integer numbers, dates as
 * ISO strings) so it can travel from a server component to the client grid unchanged.
 */

export interface LedgerLineView {
  id: string;
  lineNo: number;
  accountId: string | null;
  accountNumber: string | null;
  accountLabel: string;
  classId: string | null;
  classLabel: string;
  entityId: string | null;
  entityCode: string | null;
  debitCents: number;
  creditCents: number;
  memo: string | null;
  isBridge: boolean;
  isBank: boolean;
  isDerived: boolean;
  parentLineId: string | null;
  supersededAt: string | null;
  createdAt: string;
}

export interface LedgerNoteView {
  id: string;
  at: string;
  by: string | null;
  body: string;
}

export interface LedgerRow {
  id: string;
  seq: number;
  date: string;
  vendor: string | null;
  memo: string | null;
  status: "DRAFT" | "FLAGGED" | "POSTED" | "VOIDED";
  kind: "BANK" | "JOURNAL" | "ADJUSTING";
  source: "IMPORT" | "RECEIPT" | "STATEMENT" | "MANUAL";
  classificationSource: "IMPORT" | "VENDOR_HISTORY" | "AI" | "HUMAN" | null;
  verifiedByOwner: boolean;
  filledInBy: string | null;
  sourceFile: string | null;
  sourceRef: string | null;
  sourceRef2: string | null;
  entityId: string;
  entityCode: string;
  bankAccountId: string | null;
  bankLabel: string | null;
  /** Signed cents from the bank's point of view (money in positive); null for a journal with no bank line. */
  amountCents: number | null;
  /** Magnitude: |amount| or, for journals without a bank line, the total debits. */
  totalCents: number;
  accountId: string | null;
  accountLabel: string;
  classId: string | null;
  classLabel: string;
  /** The single user line when the transaction is not split (for inline editing). */
  primaryLineId: string | null;
  /** The original line every split line descends from, when the whole account side is one split. */
  splitRootLineId: string | null;
  isSplit: boolean;
  userLineCount: number;
  entityCodes: string[];
  isCrossEntity: boolean;
  postedAt: string | null;
  postedBy: string | null;
  voidedAt: string | null;
  voidedBy: string | null;
  voidReason: string | null;
  createdAt: string;
  createdBy: string | null;
  flags: unknown[];
  needsModelSplit: boolean;
  receiptExpectedCount: number;
  receiptCount: number;
  userNote: string | null;
  systemNotes: LedgerNoteView[];
  lines: LedgerLineView[];
  searchText: string;
}

export const yearRange = (year: number) => ({
  gte: new Date(Date.UTC(year, 0, 1)),
  lt: new Date(Date.UTC(year + 1, 0, 1)),
});

const listInclude = {
  lines: { orderBy: { lineNo: "asc" as const } },
  notes: { orderBy: { createdAt: "asc" as const } },
  bankAccount: { include: { account: { select: { number: true, name: true } } } },
} satisfies Prisma.TransactionInclude;

type ListedTransaction = Prisma.TransactionGetPayload<{ include: typeof listInclude }>;
type ListedLine = ListedTransaction["lines"][number];

async function userNames(
  tx: DbOrTx,
  ids: Iterable<string | null | undefined>,
): Promise<Map<string, string>> {
  const wanted = [...new Set([...ids].filter((x): x is string => !!x))];
  if (wanted.length === 0) return new Map();
  const users = await tx.user.findMany({
    where: { id: { in: wanted } },
    select: { id: true, displayName: true },
  });
  return new Map(users.map((u) => [u.id, u.displayName]));
}

function lineView(ref: RefData, t: ListedTransaction, l: ListedLine): LedgerLineView {
  const account = l.accountId ? ref.accounts.get(l.accountId) : null;
  const cls = l.classId ? ref.classes.get(l.classId) : null;
  const isBank = !!l.accountId && ref.bankByAccountId.has(l.accountId);
  return {
    id: l.id,
    lineNo: l.lineNo,
    accountId: l.accountId,
    accountNumber: account?.number ?? null,
    accountLabel: account ? `${account.number} ${account.name}` : "—",
    classId: l.classId,
    classLabel: cls?.name ?? "—",
    entityId: l.entityId,
    entityCode: l.entityId ? (ref.entityCodes.get(l.entityId) ?? null) : null,
    debitCents: Number(l.debitCents),
    creditCents: Number(l.creditCents),
    memo: l.memo,
    isBridge: l.isBridge,
    isBank,
    isDerived: isDerivedLine(ref, t, l),
    parentLineId: l.parentLineId,
    supersededAt: l.supersededAt ? l.supersededAt.toISOString() : null,
    createdAt: l.createdAt.toISOString(),
  };
}

function rootOf(all: ListedLine[], line: ListedLine): ListedLine {
  const byId = new Map(all.map((l) => [l.id, l]));
  let cur = line;
  while (cur.parentLineId) {
    const p = byId.get(cur.parentLineId);
    if (!p) break;
    cur = p;
  }
  return cur;
}

export function toLedgerRow(
  ref: RefData,
  names: Map<string, string>,
  t: ListedTransaction,
): LedgerRow {
  const live = t.lines.filter((l) => l.supersededAt === null);
  const user = live.filter((l) => !isDerivedLine(ref, t, l));
  const isBank = (accountId: string | null) => !!accountId && ref.bankByAccountId.has(accountId);
  const amount = bankAmount(live, isBank);
  const totalCents =
    amount !== null
      ? amount < 0n
        ? -amount
        : amount
      : totalDebits(live.filter((l) => !l.isBridge));
  const single = user.length === 1 ? (user[0] as ListedLine) : null;
  const classIds = new Set(user.map((l) => l.classId));
  const roots = new Set(user.map((l) => rootOf(t.lines, l).id));
  const rootId = roots.size === 1 ? ([...roots][0] ?? null) : null;
  const root = rootId ? t.lines.find((l) => l.id === rootId) : null;
  const splitRootLineId = user.length > 1 && root && root.supersededAt ? root.id : null;
  const entityCodes = [
    ...new Set(live.map((l) => (l.entityId ? ref.entityCodes.get(l.entityId) : null))),
  ].filter((x): x is string => !!x);
  const bankLabel = t.bankAccount ? `${t.bankAccount.account.number} ${t.bankAccount.name}` : null;
  const accountIds = new Set(user.map((l) => l.accountId));
  const onlyAccount = accountIds.size === 1 ? ref.accounts.get([...accountIds][0] ?? "") : null;
  // A bank row with several account lines is a split; a journal entry simply has several lines.
  const multi = (n: number) => (t.kind === "BANK" ? `Split (${n})` : `${n} lines`);
  const accountLabel = onlyAccount
    ? `${onlyAccount.number} ${onlyAccount.name}`
    : user.length === 0
      ? "—"
      : accountIds.size === 1
        ? "—"
        : multi(accountIds.size);
  const classLabel =
    classIds.size === 1
      ? (ref.classes.get([...classIds][0] ?? "")?.name ?? "—")
      : user.length === 0
        ? "—"
        : multi(classIds.size);
  const notesUser = t.notes.find((n) => n.kind === "USER");
  const systemNotes: LedgerNoteView[] = t.notes
    .filter((n) => n.kind === "SYSTEM")
    .map((n) => ({
      id: n.id,
      at: n.createdAt.toISOString(),
      by: n.createdById ? (names.get(n.createdById) ?? null) : null,
      body: n.body,
    }));
  const lines = live.map((l) => lineView(ref, t, l));
  const searchText = [
    `#${t.seq}`,
    t.vendor,
    t.memo,
    bankLabel,
    ...lines.map((l) => `${l.accountLabel} ${l.classLabel}`),
    notesUser?.body,
    ...systemNotes.map((n) => n.body),
    t.filledInBy,
    t.sourceRef,
    t.sourceRef2,
    amount !== null ? formatCents(amount) : formatCents(totalCents),
    formatCents(totalCents, { negative: "minus" }),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return {
    id: t.id,
    seq: Number(t.seq),
    date: toIsoDate(t.date),
    vendor: t.vendor,
    memo: t.memo,
    status: t.status,
    kind: t.kind,
    source: t.source,
    classificationSource: t.classificationSource,
    verifiedByOwner: t.verifiedByOwner,
    filledInBy: t.filledInBy,
    sourceFile: t.sourceFile,
    sourceRef: t.sourceRef,
    sourceRef2: t.sourceRef2,
    entityId: t.entityId,
    entityCode: ref.entityCodes.get(t.entityId) ?? "?",
    bankAccountId: t.bankAccountId,
    bankLabel,
    amountCents: amount === null ? null : Number(amount),
    totalCents: Number(totalCents),
    accountId: accountIds.size === 1 ? ([...accountIds][0] ?? null) : null,
    accountLabel,
    classId: classIds.size === 1 ? ([...classIds][0] ?? null) : null,
    classLabel,
    primaryLineId: single?.id ?? null,
    splitRootLineId,
    isSplit: user.length > 1,
    userLineCount: user.length,
    entityCodes,
    isCrossEntity: entityCodes.length > 1,
    postedAt: t.postedAt ? t.postedAt.toISOString() : null,
    postedBy: t.postedById ? (names.get(t.postedById) ?? null) : null,
    voidedAt: t.voidedAt ? t.voidedAt.toISOString() : null,
    voidedBy: t.voidedById ? (names.get(t.voidedById) ?? null) : null,
    voidReason: t.voidReason,
    createdAt: t.createdAt.toISOString(),
    createdBy: t.createdById ? (names.get(t.createdById) ?? null) : null,
    flags: Array.isArray(t.flags) ? (t.flags as unknown[]) : [],
    needsModelSplit: t.needsModelSplit,
    receiptExpectedCount: t.receiptExpectedCount,
    receiptCount: 0,
    userNote: notesUser?.body ?? null,
    systemNotes,
    lines,
    searchText,
  };
}

/** Every transaction of an entity dated in a year: home entity or at least one live line attributed to it. */
export async function listLedgerRows(
  tx: DbOrTx,
  scope: { entityId: string; year: number },
): Promise<LedgerRow[]> {
  const ref = await loadRefData(tx);
  const rows = await tx.transaction.findMany({
    where: {
      date: yearRange(scope.year),
      OR: [
        { entityId: scope.entityId },
        { lines: { some: { entityId: scope.entityId, supersededAt: null } } },
      ],
    },
    include: listInclude,
    orderBy: [{ date: "desc" }, { seq: "desc" }],
  });
  const names = await userNames(
    tx,
    rows.flatMap((t) => [
      t.postedById,
      t.createdById,
      t.voidedById,
      ...t.notes.map((n) => n.createdById),
    ]),
  );
  return rows.map((t) => toLedgerRow(ref, names, t));
}

export interface AuditView {
  id: string;
  at: string;
  action: string;
  user: string | null;
  reason: string | null;
  isLockOverride: boolean;
  before: unknown;
  after: unknown;
}

export interface TransactionDetail {
  row: LedgerRow;
  /** Every line ever, including superseded ones (the history). */
  allLines: LedgerLineView[];
  audit: AuditView[];
}

export async function getTransactionDetail(
  tx: DbOrTx,
  id: string,
): Promise<TransactionDetail | null> {
  const ref = await loadRefData(tx);
  const t = await tx.transaction.findUnique({ where: { id }, include: listInclude });
  if (!t) return null;
  const auditRows = await tx.auditLog.findMany({
    where: { subjectType: "transaction", subjectId: id },
    orderBy: { id: "asc" },
    include: { user: { select: { displayName: true } } },
  });
  const names = await userNames(tx, [
    t.postedById,
    t.createdById,
    t.voidedById,
    ...t.notes.map((n) => n.createdById),
  ]);
  return {
    row: toLedgerRow(ref, names, t),
    allLines: t.lines.map((l) => lineView(ref, t, l)),
    audit: auditRows.map((a) => ({
      id: a.id.toString(),
      at: a.at.toISOString(),
      action: a.action,
      user: a.user?.displayName ?? null,
      reason: a.reason,
      isLockOverride: a.isLockOverride,
      before: a.before ?? null,
      after: a.after ?? null,
    })),
  };
}

/** The pick-lists the forms need, already serialisable. */
export interface PickerData {
  entities: { id: string; code: string; name: string }[];
  bankAccounts: {
    id: string;
    entityId: string;
    entityCode: string;
    label: string;
    accountId: string;
  }[];
  accounts: {
    id: string;
    number: string;
    name: string;
    type: string;
    subType: string;
    isBank: boolean;
  }[];
  classes: { id: string; name: string; entityId: string; entityCode: string; isShared: boolean }[];
  generalClassId: string;
}

export async function loadPickerData(tx: DbOrTx): Promise<PickerData> {
  const ref = await loadRefData(tx);
  const entities = [...ref.entities.values()]
    .filter((e) => e.isActive)
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((e) => ({ id: e.id, code: e.code, name: e.name }));
  const bankAccounts = [...ref.bankAccounts.values()]
    .filter((b) => b.isActive)
    .sort((a, b) => a.accountNumber.localeCompare(b.accountNumber))
    .map((b) => ({
      id: b.id,
      entityId: b.entityId,
      entityCode: ref.entityCodes.get(b.entityId) ?? "?",
      label: `${b.accountNumber} ${b.name}`,
      accountId: b.accountId,
    }));
  const accounts = [...ref.accounts.values()]
    .filter((a) => a.isActive)
    .sort((a, b) => a.number.localeCompare(b.number))
    .map((a) => ({
      id: a.id,
      number: a.number,
      name: a.name,
      type: a.type,
      subType: a.subType,
      isBank: ref.bankByAccountId.has(a.id),
    }));
  const classes = [...ref.classes.values()]
    .filter((c) => c.isActive)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => ({
      id: c.id,
      name: c.name,
      entityId: c.entityId,
      entityCode: ref.entityCodes.get(c.entityId) ?? "?",
      isShared: c.isShared,
    }));
  return { entities, bankAccounts, accounts, classes, generalClassId: ref.generalClassId };
}
