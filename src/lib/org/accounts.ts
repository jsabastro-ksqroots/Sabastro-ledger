import type { DbOrTx } from "@/lib/db";
import { audit } from "@/lib/audit";
import type { RequestMeta } from "@/lib/auth/session";
import type { Role } from "@/lib/auth/permissions";

/**
 * Chart of accounts: pure functions over a Prisma client or transaction so they can be tested
 * without Next.js. Account numbers are the permanent identifiers; names and grouping are editable.
 * Accounts are never deleted — an account with postings can only be deactivated.
 */

export type Actor = { userId: string; sessionId: string | null; role?: Role } & RequestMeta;

export class AccountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountError";
  }
}

export const ACCOUNT_TYPES = ["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"] as const;
export type AccountTypeKey = (typeof ACCOUNT_TYPES)[number];

export const ACCOUNT_TYPE_LABELS: Record<AccountTypeKey, string> = {
  ASSET: "Asset",
  LIABILITY: "Liability",
  EQUITY: "Equity",
  INCOME: "Income",
  EXPENSE: "Expense",
};

/** Sub-types present in seed/chart_of_accounts.csv, offered as suggestions (free text is still allowed). */
export const SEED_SUB_TYPES = [
  "Bank",
  "Other Current Assets",
  "Fixed Asset",
  "Other Current Liabilities",
  "Equity",
  "Income",
  "Expense",
] as const;

/** Second-level sub-types present in the seed. */
export const SEED_SUB_TYPES_2 = [
  "Bank Accounts",
  "Paid Deposits",
  "Property Assets",
  "Error Capitalized Expenses",
  "Accounts Receivable",
  "Liabilities",
  "Capital Contributions",
  "Income",
  "Acquisition Expenses",
  "Operating Expenses",
  "Depreciation Expense",
] as const;

/** Seed rows whose parent/type were inferred from the 2025 ledger and still need Jose's confirmation. */
export const INFERRED_NOTE = /INFERRED\s*-\s*confirm/i;

export function isInferredAccount(account: { note: string | null }): boolean {
  return !!account.note && INFERRED_NOTE.test(account.note);
}

export function accountLabel(account: { number: string; name: string }): string {
  return `${account.number} ${account.name}`;
}

export interface AccountInput {
  number: string;
  name: string;
  parentGroup: string;
  type: AccountTypeKey;
  subType: string;
  subType2?: string | null;
  note?: string | null;
}

export type AccountUpdate = Omit<AccountInput, "number">;

const NUMBER_RE = /^\d{4}$/;

function clean(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function optional(value: string | null | undefined): string | null {
  const v = clean(value);
  return v.length ? v : null;
}

/** "5200 Operating Expenses" → "Operating Expenses" (the seed's convention for the second sub-type). */
function parentGroupName(parentGroup: string): string {
  return parentGroup.replace(/^\d{4}\s+/, "").trim();
}

function validateCommon(input: AccountUpdate) {
  const name = clean(input.name);
  if (!name) throw new AccountError("Give the account a name.");
  if (name.length > 120)
    throw new AccountError("The account name is too long (120 characters at most).");
  const parentGroup = clean(input.parentGroup);
  if (!parentGroup)
    throw new AccountError(
      "Choose or type a parent group (for example “5200 Operating Expenses”).",
    );
  if (!ACCOUNT_TYPES.includes(input.type))
    throw new AccountError("Choose an account type: Asset, Liability, Equity, Income or Expense.");
  const subType = clean(input.subType);
  if (!subType)
    throw new AccountError("Choose or type a sub-type (for example “Expense” or “Fixed Asset”).");
  const subType2 = clean(input.subType2) || parentGroupName(parentGroup) || subType;
  const note = optional(input.note);
  if (note && note.length > 1000)
    throw new AccountError("The note is too long (1,000 characters at most).");
  return { name, parentGroup, type: input.type, subType, subType2, note };
}

export async function listAccounts(
  tx: DbOrTx,
  opts: { includeInactive?: boolean; search?: string } = {},
) {
  const search = clean(opts.search);
  return tx.account.findMany({
    where: {
      ...(opts.includeInactive ? {} : { isActive: true }),
      ...(search
        ? {
            OR: [
              { number: { contains: search } },
              { name: { contains: search, mode: "insensitive" } },
              { parentGroup: { contains: search, mode: "insensitive" } },
              { note: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: [{ number: "asc" }],
    include: { bankAccount: { select: { id: true, name: true, isActive: true } } },
  });
}

export type AccountRow = Awaited<ReturnType<typeof listAccounts>>[number];

/** Parent groups already in use, sorted (they start with the group's number so the order is natural). */
export async function distinctParentGroups(tx: DbOrTx): Promise<string[]> {
  const rows = await tx.account.findMany({
    select: { parentGroup: true },
    distinct: ["parentGroup"],
    orderBy: { parentGroup: "asc" },
  });
  return rows.map((r) => r.parentGroup);
}

/** Sub-type suggestions: the seed's lists plus anything the users have typed since. */
export async function subTypeSuggestions(
  tx: DbOrTx,
): Promise<{ subTypes: string[]; subTypes2: string[] }> {
  const rows = await tx.account.findMany({ select: { subType: true, subType2: true } });
  const subTypes = new Set<string>(SEED_SUB_TYPES);
  const subTypes2 = new Set<string>(SEED_SUB_TYPES_2);
  for (const r of rows) {
    if (r.subType) subTypes.add(r.subType);
    if (r.subType2) subTypes2.add(r.subType2);
  }
  return { subTypes: [...subTypes].sort(), subTypes2: [...subTypes2].sort() };
}

export async function createAccount(tx: DbOrTx, actor: Actor, input: AccountInput) {
  const number = clean(input.number);
  if (!NUMBER_RE.test(number))
    throw new AccountError("The account number must be exactly 4 digits, for example 5228.");
  const fields = validateCommon(input);
  const existing = await tx.account.findUnique({ where: { number } });
  if (existing)
    throw new AccountError(
      `Number ${number} is already used by “${existing.name}”. Pick a different number.`,
    );
  const account = await tx.account.create({ data: { number, ...fields, source: "added in app" } });
  await audit(tx, {
    action: "account.create",
    userId: actor.userId,
    sessionId: actor.sessionId,
    subjectType: "account",
    subjectId: account.id,
    subjectLabel: accountLabel(account),
    after: snapshot(account),
    ip: actor.ip,
    userAgent: actor.userAgent,
  });
  return account;
}

export async function updateAccount(tx: DbOrTx, actor: Actor, id: string, input: AccountUpdate) {
  const before = await tx.account.findUnique({ where: { id } });
  if (!before) throw new AccountError("That account no longer exists.");
  const fields = validateCommon(input);
  const after = await tx.account.update({ where: { id }, data: fields });
  await audit(tx, {
    action: "account.update",
    userId: actor.userId,
    sessionId: actor.sessionId,
    subjectType: "account",
    subjectId: id,
    subjectLabel: accountLabel(before),
    before: snapshot(before),
    after: snapshot(after),
    ip: actor.ip,
    userAgent: actor.userAgent,
  });
  return after;
}

export async function setAccountActive(tx: DbOrTx, actor: Actor, id: string, isActive: boolean) {
  const before = await tx.account.findUnique({ where: { id }, include: { bankAccount: true } });
  if (!before) throw new AccountError("That account no longer exists.");
  if (before.isActive === isActive) return before;
  if (!isActive) {
    if (before.bankAccount?.isActive) {
      throw new AccountError(
        `${accountLabel(before)} is the ledger account behind the bank account “${before.bankAccount.name}”. Deactivate that bank account first (Settings → Entities & bank accounts).`,
      );
    }
    const bridgeUses = await tx.entityBridgeRule.count({
      where: { OR: [{ payerAccountId: id }, { receiverAccountId: id }] },
    });
    if (bridgeUses > 0) {
      throw new AccountError(
        `${accountLabel(before)} is used by the cross-entity bridge rule (the distribution/contribution pair that keeps each business balanced). Point the bridge rule at another account first.`,
      );
    }
  }
  const after = await tx.account.update({ where: { id }, data: { isActive } });
  await audit(tx, {
    action: isActive ? "account.reactivate" : "account.deactivate",
    userId: actor.userId,
    sessionId: actor.sessionId,
    subjectType: "account",
    subjectId: id,
    subjectLabel: accountLabel(before),
    before: { isActive: before.isActive },
    after: { isActive: after.isActive },
    ip: actor.ip,
    userAgent: actor.userAgent,
  });
  return after;
}

function snapshot(a: {
  number: string;
  name: string;
  parentGroup: string;
  type: string;
  subType: string;
  subType2: string;
  note: string | null;
  isActive: boolean;
}) {
  return {
    number: a.number,
    name: a.name,
    parentGroup: a.parentGroup,
    type: a.type,
    subType: a.subType,
    subType2: a.subType2,
    note: a.note,
    isActive: a.isActive,
  };
}
