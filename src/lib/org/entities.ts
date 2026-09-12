import type { DbOrTx } from "@/lib/db";
import { audit } from "@/lib/audit";
import type { RequestMeta } from "@/lib/auth/session";
import type { AccountType, BankAccountKind, BridgeMode, TaxForm } from "@/generated/prisma/client";

/**
 * Entities, bank accounts and cross-entity bridge rules — the building blocks of the books.
 * Pure functions over a Prisma client/transaction so they can be tested without Next.js.
 * Every write records a before/after snapshot in the audit log.
 */

export type Actor = { userId: string; sessionId: string | null } & RequestMeta;

/** A validation problem worded for the two non-technical users; server actions show its message as-is. */
export class EntityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EntityError";
  }
}

export const TAX_FORM_LABELS: Record<TaxForm, string> = {
  FORM_1065: "Form 1065 (partnership)",
  SCHEDULE_C: "Schedule C (sole proprietor)",
  FORM_1120S: "Form 1120-S (S corporation)",
};

export const BANK_KIND_LABELS: Record<BankAccountKind, string> = {
  CHECKING: "Checking",
  SAVINGS: "Savings",
  CASH_APP: "Cash app (Venmo)",
};

export const BRIDGE_MODE_LABELS: Record<BridgeMode, string> = {
  DISTRIBUTION_CONTRIBUTION: "Distribution / contribution (through Jose)",
  INTERCOMPANY: "Intercompany (due to / due from)",
};

export const TAX_FORMS = [
  "FORM_1065",
  "SCHEDULE_C",
  "FORM_1120S",
] as const satisfies readonly TaxForm[];
export const BANK_KINDS = [
  "CHECKING",
  "SAVINGS",
  "CASH_APP",
] as const satisfies readonly BankAccountKind[];
export const BRIDGE_MODES = [
  "DISTRIBUTION_CONTRIBUTION",
  "INTERCOMPANY",
] as const satisfies readonly BridgeMode[];

/** The ledger group every new bank account lands in (matches seed/chart_of_accounts.csv). */
export const BANK_PARENT_GROUP = "1100 Bank Accounts";
export const BANK_SUB_TYPE = "Bank";
export const BANK_SUB_TYPE_2 = "Bank Accounts";

const ENTITY_CODE = /^[A-Z]{2,8}$/;
const ACCOUNT_NUMBER = /^[0-9]{4}$/;
const LAST4 = /^[0-9]{4}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function cleanText(
  value: string | null | undefined,
  label: string,
  max: number,
  required: boolean,
): string | null {
  const s = (value ?? "").trim();
  if (!s) {
    if (required) throw new EntityError(`${label} is required.`);
    return null;
  }
  if (s.length > max) throw new EntityError(`${label} must be ${max} characters or fewer.`);
  return s;
}

/** Calendar dates arrive as "YYYY-MM-DD" and are stored at UTC midnight (DATE column, no time zone). */
function parseDate(value: string | null | undefined, label: string): Date | null {
  const s = (value ?? "").trim();
  if (!s) return null;
  if (!ISO_DATE.test(s)) throw new EntityError(`${label} must be a calendar date (YYYY-MM-DD).`);
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s)
    throw new EntityError(`${label} is not a real date.`);
  return d;
}

function isoDate(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

function actorFields(actor: Actor) {
  return {
    userId: actor.userId,
    sessionId: actor.sessionId,
    ip: actor.ip ?? null,
    userAgent: actor.userAgent ?? null,
  };
}

/** The Postgres trigger message for a non-Bank ledger account, translated for the users. */
function translateDbError(err: unknown): never {
  const message = err instanceof Error ? err.message : String(err);
  if (/sub_type Bank/i.test(message)) {
    throw new EntityError(
      "That ledger account is not a bank account. Only accounts of sub-type “Bank” (the 1100 group) can be linked to a bank account.",
    );
  }
  if (/bank_accounts_dates/i.test(message)) {
    throw new EntityError("The closed date cannot be earlier than the opened date.");
  }
  if (/accounts_number_key|Unique constraint failed.*number/i.test(message)) {
    throw new EntityError("That account number is already in the chart of accounts.");
  }
  if (/bank_accounts_account_id_key|Unique constraint failed.*account_id/i.test(message)) {
    throw new EntityError("That ledger account is already linked to a bank account.");
  }
  throw err;
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export async function listEntitiesWithBankAccounts(tx: DbOrTx) {
  return tx.entity.findMany({
    orderBy: [{ isActive: "desc" }, { code: "asc" }],
    include: {
      bankAccounts: {
        include: { account: { select: { id: true, number: true, name: true, isActive: true } } },
        orderBy: [{ isActive: "desc" }, { account: { number: "asc" } }],
      },
    },
  });
}

export async function createEntity(
  tx: DbOrTx,
  actor: Actor,
  input: { code: string; name: string; legalName?: string | null; taxForm: TaxForm },
) {
  const code = (input.code ?? "").trim().toUpperCase();
  if (!ENTITY_CODE.test(code))
    throw new EntityError("The short code must be 2 to 8 letters, like SREI or PLA.");
  const name = cleanText(input.name, "Name", 120, true) as string;
  const legalName = cleanText(input.legalName, "Legal name", 200, false);
  if (!TAX_FORMS.includes(input.taxForm)) throw new EntityError("Pick a tax form.");
  const existing = await tx.entity.findUnique({ where: { code } });
  if (existing) throw new EntityError(`An entity with the code ${code} already exists.`);
  const entity = await tx.entity.create({
    data: { code, name, legalName, taxForm: input.taxForm },
  });
  await audit(tx, {
    action: "entity.create",
    ...actorFields(actor),
    subjectType: "entity",
    subjectId: entity.id,
    subjectLabel: entity.code,
    entityId: entity.id,
    after: {
      code: entity.code,
      name: entity.name,
      legalName: entity.legalName,
      taxForm: entity.taxForm,
      isActive: entity.isActive,
    },
  });
  return entity;
}

export async function updateEntity(
  tx: DbOrTx,
  actor: Actor,
  id: string,
  input: { name?: string; legalName?: string | null; taxForm?: TaxForm; isActive?: boolean },
) {
  const before = await tx.entity.findUnique({ where: { id } });
  if (!before) throw new EntityError("That entity no longer exists.");
  const name =
    input.name === undefined ? before.name : (cleanText(input.name, "Name", 120, true) as string);
  const legalName =
    input.legalName === undefined
      ? before.legalName
      : cleanText(input.legalName, "Legal name", 200, false);
  const taxForm = input.taxForm ?? before.taxForm;
  if (!TAX_FORMS.includes(taxForm)) throw new EntityError("Pick a tax form.");
  const isActive = input.isActive ?? before.isActive;
  if (before.isActive && !isActive) {
    const [activeBanks, activeClasses] = await Promise.all([
      tx.bankAccount.count({ where: { entityId: id, isActive: true } }),
      tx.class.count({ where: { entityId: id, isActive: true, isShared: false } }),
    ]);
    if (activeBanks > 0 || activeClasses > 0) {
      const parts = [
        activeBanks > 0
          ? `${activeBanks} active bank account${activeBanks === 1 ? "" : "s"}`
          : null,
        activeClasses > 0
          ? `${activeClasses} active class${activeClasses === 1 ? "" : "es"}`
          : null,
      ].filter(Boolean);
      throw new EntityError(
        `${before.code} still has ${parts.join(" and ")}. Deactivate those first, then deactivate the entity.`,
      );
    }
  }
  const after = await tx.entity.update({
    where: { id },
    data: { name, legalName, taxForm, isActive },
  });
  await audit(tx, {
    action:
      before.isActive && !isActive
        ? "entity.deactivate"
        : !before.isActive && isActive
          ? "entity.reactivate"
          : "entity.update",
    ...actorFields(actor),
    subjectType: "entity",
    subjectId: id,
    subjectLabel: before.code,
    entityId: id,
    before: {
      name: before.name,
      legalName: before.legalName,
      taxForm: before.taxForm,
      isActive: before.isActive,
    },
    after: {
      name: after.name,
      legalName: after.legalName,
      taxForm: after.taxForm,
      isActive: after.isActive,
    },
  });
  return after;
}

// ---------------------------------------------------------------------------
// Bank accounts
// ---------------------------------------------------------------------------

/** Bank-type ledger accounts that no bank account row points at yet. */
export async function listUnlinkedBankLedgerAccounts(tx: DbOrTx) {
  return tx.account.findMany({
    where: { subType: BANK_SUB_TYPE, bankAccount: null },
    orderBy: { number: "asc" },
    select: { id: true, number: true, name: true, isActive: true },
  });
}

export interface BankAccountFields {
  name: string;
  institution?: string | null;
  kind: BankAccountKind;
  last4?: string | null;
  openedOn?: string | null;
  closedOn?: string | null;
}

function cleanBankFields(input: BankAccountFields) {
  const name = cleanText(input.name, "Name", 80, true) as string;
  const institution = cleanText(input.institution, "Institution", 120, false);
  if (!BANK_KINDS.includes(input.kind))
    throw new EntityError("Pick the kind of account (checking, savings or cash app).");
  const last4Raw = (input.last4 ?? "").trim();
  if (last4Raw && !LAST4.test(last4Raw))
    throw new EntityError("Last 4 must be exactly four digits (or leave it blank).");
  const last4 = last4Raw || null;
  const openedOn = parseDate(input.openedOn, "Opened on");
  const closedOn = parseDate(input.closedOn, "Closed on");
  if (openedOn && closedOn && closedOn < openedOn)
    throw new EntityError("The closed date cannot be earlier than the opened date.");
  return { name, institution, kind: input.kind, last4, openedOn, closedOn };
}

function bankSnapshot(row: {
  entityId: string;
  accountId: string;
  name: string;
  institution: string | null;
  kind: BankAccountKind;
  last4: string | null;
  openedOn: Date | null;
  closedOn: Date | null;
  isActive: boolean;
}) {
  return {
    entityId: row.entityId,
    accountId: row.accountId,
    name: row.name,
    institution: row.institution,
    kind: row.kind,
    last4: row.last4,
    openedOn: isoDate(row.openedOn),
    closedOn: isoDate(row.closedOn),
    isActive: row.isActive,
  };
}

export async function createBankAccount(
  tx: DbOrTx,
  actor: Actor,
  input: BankAccountFields & {
    entityId: string;
    accountId?: string | null;
    newAccount?: { number: string; name: string } | null;
  },
) {
  const entity = await tx.entity.findUnique({ where: { id: input.entityId } });
  if (!entity) throw new EntityError("That entity no longer exists.");
  if (!entity.isActive)
    throw new EntityError(`${entity.code} is inactive. Reactivate it before adding bank accounts.`);
  const fields = cleanBankFields(input);

  let accountId: string;
  let createdAccount: { number: string; name: string } | null = null;
  if (input.newAccount) {
    const number = (input.newAccount.number ?? "").trim();
    if (!ACCOUNT_NUMBER.test(number))
      throw new EntityError("A ledger account number is exactly four digits, like 1105.");
    const accountName = cleanText(
      input.newAccount.name,
      "Ledger account name",
      120,
      true,
    ) as string;
    const clash = await tx.account.findUnique({ where: { number } });
    if (clash)
      throw new EntityError(
        `Account number ${number} is already used by “${clash.name}”. Pick another number or link that account instead.`,
      );
    const account = await tx.account.create({
      data: {
        number,
        name: accountName,
        parentGroup: BANK_PARENT_GROUP,
        type: "ASSET",
        subType: BANK_SUB_TYPE,
        subType2: BANK_SUB_TYPE_2,
        source: "Settings",
      },
    });
    accountId = account.id;
    createdAccount = { number: account.number, name: account.name };
    await audit(tx, {
      action: "account.create",
      ...actorFields(actor),
      subjectType: "account",
      subjectId: account.id,
      subjectLabel: `${account.number} ${account.name}`,
      entityId: entity.id,
      after: {
        number: account.number,
        name: account.name,
        parentGroup: account.parentGroup,
        type: account.type,
        subType: account.subType,
        subType2: account.subType2,
        source: account.source,
      },
    });
  } else if (input.accountId) {
    const account = await tx.account.findUnique({
      where: { id: input.accountId },
      include: { bankAccount: true },
    });
    if (!account) throw new EntityError("Pick a ledger account for this bank account.");
    if (account.bankAccount)
      throw new EntityError(
        `${account.number} ${account.name} is already linked to a bank account.`,
      );
    accountId = account.id;
  } else {
    throw new EntityError(
      "Pick an existing ledger account or enter a new account number and name.",
    );
  }

  let row;
  try {
    row = await tx.bankAccount.create({
      data: { entityId: entity.id, accountId, ...fields },
      include: { account: { select: { number: true, name: true } } },
    });
  } catch (err) {
    translateDbError(err);
  }
  await audit(tx, {
    action: "bank_account.create",
    ...actorFields(actor),
    subjectType: "bank_account",
    subjectId: row.id,
    subjectLabel: `${row.account.number} ${row.name}`,
    entityId: entity.id,
    after: {
      ...bankSnapshot(row),
      entityCode: entity.code,
      ledgerAccount: `${row.account.number} ${row.account.name}`,
      createdAccount,
    },
  });
  return row;
}

export async function updateBankAccount(
  tx: DbOrTx,
  actor: Actor,
  id: string,
  input: Partial<BankAccountFields> & { isActive?: boolean },
) {
  const before = await tx.bankAccount.findUnique({
    where: { id },
    include: {
      account: { select: { number: true, name: true } },
      entity: { select: { code: true } },
    },
  });
  if (!before) throw new EntityError("That bank account no longer exists.");
  const merged: BankAccountFields = {
    name: input.name ?? before.name,
    institution: input.institution === undefined ? before.institution : input.institution,
    kind: input.kind ?? before.kind,
    last4: input.last4 === undefined ? before.last4 : input.last4,
    openedOn: input.openedOn === undefined ? isoDate(before.openedOn) : input.openedOn,
    closedOn: input.closedOn === undefined ? isoDate(before.closedOn) : input.closedOn,
  };
  const fields = cleanBankFields(merged);
  const isActive = input.isActive ?? before.isActive;
  let after;
  try {
    after = await tx.bankAccount.update({
      where: { id },
      data: { ...fields, isActive },
      include: { account: { select: { number: true, name: true } } },
    });
  } catch (err) {
    translateDbError(err);
  }
  const action =
    before.isActive && !isActive
      ? "bank_account.deactivate"
      : !before.isActive && isActive
        ? "bank_account.reactivate"
        : "bank_account.update";
  await audit(tx, {
    action,
    ...actorFields(actor),
    subjectType: "bank_account",
    subjectId: id,
    subjectLabel: `${before.account.number} ${before.name}`,
    entityId: before.entityId,
    before: bankSnapshot(before),
    after: bankSnapshot(after),
  });
  return after;
}

// ---------------------------------------------------------------------------
// Cross-entity bridge rules
// ---------------------------------------------------------------------------

export async function listBridgeRules(tx: DbOrTx) {
  return tx.entityBridgeRule.findMany({
    include: {
      payerEntity: { select: { id: true, code: true, name: true, isActive: true } },
      receiverEntity: { select: { id: true, code: true, name: true, isActive: true } },
      payerAccount: { select: { id: true, number: true, name: true, type: true } },
      receiverAccount: { select: { id: true, number: true, name: true, type: true } },
    },
    orderBy: [{ payerEntity: { code: "asc" } }, { receiverEntity: { code: "asc" } }],
  });
}

/** Accounts offered in the bridge-rule dialog: every active account, so Intercompany can pick any of them. */
export async function listBridgeAccountChoices(tx: DbOrTx) {
  return tx.account.findMany({
    where: { isActive: true },
    orderBy: { number: "asc" },
    select: { id: true, number: true, name: true, type: true },
  });
}

export async function upsertBridgeRule(
  tx: DbOrTx,
  actor: Actor,
  input: {
    payerEntityId: string;
    receiverEntityId: string;
    mode: BridgeMode;
    payerAccountId: string;
    receiverAccountId: string;
  },
) {
  if (!input.payerEntityId || !input.receiverEntityId)
    throw new EntityError("Pick the paying and the receiving entity.");
  if (input.payerEntityId === input.receiverEntityId)
    throw new EntityError("The paying and receiving entity must be different.");
  if (!BRIDGE_MODES.includes(input.mode)) throw new EntityError("Pick how the payment is bridged.");
  const [payer, receiver] = await Promise.all([
    tx.entity.findUnique({ where: { id: input.payerEntityId } }),
    tx.entity.findUnique({ where: { id: input.receiverEntityId } }),
  ]);
  if (!payer || !receiver) throw new EntityError("One of those entities no longer exists.");
  if (!input.payerAccountId || !input.receiverAccountId)
    throw new EntityError("Pick both accounts for the bridge.");
  const [payerAccount, receiverAccount] = await Promise.all([
    tx.account.findUnique({ where: { id: input.payerAccountId } }),
    tx.account.findUnique({ where: { id: input.receiverAccountId } }),
  ]);
  if (!payerAccount || !receiverAccount)
    throw new EntityError("One of those accounts no longer exists.");
  for (const a of [payerAccount, receiverAccount]) {
    if (!a.isActive)
      throw new EntityError(`${a.number} ${a.name} is inactive. Pick an active account.`);
  }
  if (input.mode === "DISTRIBUTION_CONTRIBUTION") {
    const notEquity = [payerAccount, receiverAccount].filter(
      (a) => (a.type as AccountType) !== "EQUITY",
    );
    if (notEquity.length) {
      throw new EntityError(
        `Distribution / contribution bridges must use equity accounts (like 3102 Capital Distribution and 3101 Capital Contribution). ${notEquity.map((a) => `${a.number} ${a.name}`).join(" and ")} ${notEquity.length === 1 ? "is" : "are"} not equity.`,
      );
    }
  }
  const where = {
    payerEntityId_receiverEntityId: { payerEntityId: payer.id, receiverEntityId: receiver.id },
  };
  const before = await tx.entityBridgeRule.findUnique({
    where,
    include: {
      payerAccount: { select: { number: true, name: true } },
      receiverAccount: { select: { number: true, name: true } },
    },
  });
  const data = {
    mode: input.mode,
    payerAccountId: payerAccount.id,
    receiverAccountId: receiverAccount.id,
  };
  const after = before
    ? await tx.entityBridgeRule.update({ where, data })
    : await tx.entityBridgeRule.create({
        data: { payerEntityId: payer.id, receiverEntityId: receiver.id, ...data },
      });
  await audit(tx, {
    action: before ? "bridge_rule.update" : "bridge_rule.create",
    ...actorFields(actor),
    subjectType: "entity_bridge_rule",
    subjectId: after.id,
    subjectLabel: `${payer.code} → ${receiver.code}`,
    entityId: payer.id,
    before: before
      ? {
          mode: before.mode,
          payerAccount: `${before.payerAccount.number} ${before.payerAccount.name}`,
          receiverAccount: `${before.receiverAccount.number} ${before.receiverAccount.name}`,
        }
      : undefined,
    after: {
      mode: after.mode,
      payerAccount: `${payerAccount.number} ${payerAccount.name}`,
      receiverAccount: `${receiverAccount.number} ${receiverAccount.name}`,
    },
  });
  return after;
}
