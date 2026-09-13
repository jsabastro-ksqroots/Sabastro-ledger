import type { DbOrTx } from "@/lib/db";
import type { AttributionContext } from "./attribution";
import type { BridgeRule } from "./bridge";
import { LedgerError } from "./errors";

/**
 * Everything the ledger core needs to know about the books' building blocks, loaded once per operation:
 * entities, bank accounts, the chart, classes and the cross-entity bridge rules.
 */

export interface RefEntity {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}

export interface RefBankAccount {
  id: string;
  entityId: string;
  accountId: string;
  name: string;
  isActive: boolean;
  accountNumber: string;
  accountName: string;
}

export interface RefAccount {
  id: string;
  number: string;
  name: string;
  type: string;
  subType: string;
  isActive: boolean;
}

export interface RefClass {
  id: string;
  name: string;
  entityId: string;
  isShared: boolean;
  isActive: boolean;
}

export interface RefData {
  entities: Map<string, RefEntity>;
  bankAccounts: Map<string, RefBankAccount>;
  /** Ledger account id → bank account (for "is this a bank line?" and attribution rule 1). */
  bankByAccountId: Map<string, RefBankAccount>;
  bankEntityByAccountId: Map<string, string>;
  accounts: Map<string, RefAccount>;
  classes: Map<string, RefClass>;
  generalClassId: string;
  rules: BridgeRule[];
  defaultPayerAccountId: string;
  defaultReceiverAccountId: string;
  entityCodes: Map<string, string>;
}

export const DEFAULT_PAYER_ACCOUNT_NUMBER = "3102";
export const DEFAULT_RECEIVER_ACCOUNT_NUMBER = "3101";

export async function loadRefData(tx: DbOrTx): Promise<RefData> {
  const [entities, bankAccounts, accounts, classes, rules] = await Promise.all([
    tx.entity.findMany({ select: { id: true, code: true, name: true, isActive: true } }),
    tx.bankAccount.findMany({
      select: {
        id: true,
        entityId: true,
        accountId: true,
        name: true,
        isActive: true,
        account: { select: { number: true, name: true } },
      },
    }),
    tx.account.findMany({
      select: { id: true, number: true, name: true, type: true, subType: true, isActive: true },
    }),
    tx.class.findMany({
      select: { id: true, name: true, entityId: true, isShared: true, isActive: true },
    }),
    tx.entityBridgeRule.findMany({
      select: {
        payerEntityId: true,
        receiverEntityId: true,
        payerAccountId: true,
        receiverAccountId: true,
      },
    }),
  ]);

  const general = classes.find((c) => c.isShared) ?? classes.find((c) => c.name === "General");
  if (!general)
    throw new LedgerError(
      "The shared “General” class is missing. Run the seed (pnpm db:seed) and try again.",
    );
  const byNumber = (n: string) => accounts.find((a) => a.number === n)?.id;
  const defaultPayerAccountId = byNumber(DEFAULT_PAYER_ACCOUNT_NUMBER);
  const defaultReceiverAccountId = byNumber(DEFAULT_RECEIVER_ACCOUNT_NUMBER);
  if (!defaultPayerAccountId || !defaultReceiverAccountId)
    throw new LedgerError(
      "Accounts 3101 Capital Contribution and 3102 Capital Distribution are missing from the chart; the cross-entity bridge needs them.",
    );

  const banks: RefBankAccount[] = bankAccounts.map((b) => ({
    id: b.id,
    entityId: b.entityId,
    accountId: b.accountId,
    name: b.name,
    isActive: b.isActive,
    accountNumber: b.account.number,
    accountName: b.account.name,
  }));
  return {
    entities: new Map(entities.map((e) => [e.id, e])),
    bankAccounts: new Map(banks.map((b) => [b.id, b])),
    bankByAccountId: new Map(banks.map((b) => [b.accountId, b])),
    bankEntityByAccountId: new Map(banks.map((b) => [b.accountId, b.entityId])),
    accounts: new Map(accounts.map((a) => [a.id, a])),
    classes: new Map(classes.map((c) => [c.id, c])),
    generalClassId: general.id,
    rules,
    defaultPayerAccountId,
    defaultReceiverAccountId,
    entityCodes: new Map(entities.map((e) => [e.id, e.code])),
  };
}

export function attributionContext(ref: RefData, homeEntityId: string): AttributionContext {
  return {
    homeEntityId,
    bankEntityByAccountId: ref.bankEntityByAccountId,
    classes: ref.classes,
  };
}

export function accountLabel(ref: RefData, accountId: string | null): string {
  if (!accountId) return "—";
  const a = ref.accounts.get(accountId);
  return a ? `${a.number} ${a.name}` : "unknown account";
}

export function classLabel(ref: RefData, classId: string | null): string {
  if (!classId) return "—";
  return ref.classes.get(classId)?.name ?? "unknown class";
}
