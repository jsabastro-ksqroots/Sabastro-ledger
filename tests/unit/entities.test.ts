import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient, db, disconnectDb } from "@/lib/db";
import {
  BANK_PARENT_GROUP,
  createBankAccount,
  createEntity,
  EntityError,
  listUnlinkedBankLedgerAccounts,
  updateBankAccount,
  updateEntity,
  upsertBridgeRule,
} from "@/lib/org/entities";

const owner = createPrismaClient(process.env.DATABASE_URL as string);
const meta = { ip: null, userAgent: "vitest", sessionId: null };
let actor: { userId: string; sessionId: null; ip: null; userAgent: string };

beforeAll(async () => {
  const user = await owner.user.create({
    data: {
      email: `entities-${Date.now()}@test.local`,
      displayName: "Entities tester",
      passwordHash: "!test",
      role: "FULL",
    },
  });
  actor = { userId: user.id, ...meta };
});

afterAll(async () => {
  await owner.$disconnect();
  await disconnectDb();
});

/** 2–8 letters, unique per call (entity codes must be letters only). */
function uniqueCode(prefix = "T"): string {
  const letters = Date.now()
    .toString()
    .replace(/\d/g, (d) => String.fromCharCode(65 + Number(d)));
  return (
    prefix +
    letters.slice(-6) +
    String.fromCharCode(65 + Math.floor(Math.random() * 26))
  ).slice(0, 8);
}

/** A 4-digit account number nobody uses yet. */
async function freeNumber(): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const n = String(9000 + Math.floor(Math.random() * 1000));
    if (!(await db.account.findUnique({ where: { number: n } }))) return n;
  }
  throw new Error("could not find a free account number");
}

async function makeEntity(name = "Test Entity") {
  return createEntity(db, actor, {
    code: uniqueCode(),
    name,
    legalName: `${name} LLC`,
    taxForm: "SCHEDULE_C",
  });
}

async function makeAccount(type: "ASSET" | "EQUITY" | "EXPENSE", subType: string, name: string) {
  return owner.account.create({
    data: {
      number: await freeNumber(),
      name,
      parentGroup: "9000 Test",
      type,
      subType,
      subType2: subType,
      source: "test",
    },
  });
}

describe("entities and bank accounts", () => {
  it("creates a bank account together with a new Bank-type ledger account and audits both", async () => {
    const entity = await makeEntity();
    const number = await freeNumber();
    const row = await db.$transaction((tx) =>
      createBankAccount(tx, actor, {
        entityId: entity.id,
        newAccount: { number, name: "Test Savings" },
        name: "Savings",
        institution: "Test Bank",
        kind: "SAVINGS",
        last4: "1234",
        openedOn: "2026-01-15",
        closedOn: null,
      }),
    );
    const account = await db.account.findUniqueOrThrow({ where: { number } });
    expect(account.type).toBe("ASSET");
    expect(account.subType).toBe("Bank");
    expect(account.subType2).toBe("Bank Accounts");
    expect(account.parentGroup).toBe(BANK_PARENT_GROUP);
    expect(account.source).toBe("Settings");
    expect(row.accountId).toBe(account.id);
    expect(row.openedOn?.toISOString().slice(0, 10)).toBe("2026-01-15");
    const audits = await db.auditLog.findMany({
      where: { userId: actor.userId, subjectId: { in: [row.id, account.id] } },
      orderBy: { id: "asc" },
    });
    expect(audits.map((a) => a.action)).toEqual(["account.create", "bank_account.create"]);
    expect(audits[1]?.subjectLabel).toBe(`${number} Savings`);
    expect(audits[1]?.entityId).toBe(entity.id);
    // the new ledger account is linked, so it no longer shows up as unlinked
    const unlinked = await listUnlinkedBankLedgerAccounts(db);
    expect(unlinked.find((a) => a.id === account.id)).toBeUndefined();
  });

  it("rejects a 3-digit ledger number and a duplicate number", async () => {
    const entity = await makeEntity();
    await expect(
      createBankAccount(db, actor, {
        entityId: entity.id,
        newAccount: { number: "110", name: "Bad" },
        name: "Bad",
        kind: "CHECKING",
      }),
    ).rejects.toThrow(/four digits/i);
    const existing = await makeAccount("EQUITY", "Equity", "Clash");
    await expect(
      createBankAccount(db, actor, {
        entityId: entity.id,
        newAccount: { number: existing.number, name: "Bad" },
        name: "Bad",
        kind: "CHECKING",
      }),
    ).rejects.toThrow(/already used/i);
    expect(await db.bankAccount.count({ where: { entityId: entity.id } })).toBe(0);
  });

  it("refuses to link an EXPENSE account — the database trigger fires and the message is translated", async () => {
    const entity = await makeEntity();
    const expense = await makeAccount("EXPENSE", "Expenses", "Not a bank");
    await expect(
      createBankAccount(db, actor, {
        entityId: entity.id,
        accountId: expense.id,
        name: "Oops",
        kind: "CHECKING",
      }),
    ).rejects.toThrow(EntityError);
    await expect(
      createBankAccount(db, actor, {
        entityId: entity.id,
        accountId: expense.id,
        name: "Oops",
        kind: "CHECKING",
      }),
    ).rejects.toThrow(/not a bank account/i);
    expect(await db.bankAccount.findUnique({ where: { accountId: expense.id } })).toBeNull();
    // the trigger is the real guard: even the owner connection cannot bypass it
    await expect(
      owner.bankAccount.create({
        data: { entityId: entity.id, accountId: expense.id, name: "Direct" },
      }),
    ).rejects.toThrow(/sub_type Bank/);
  });

  it("deactivates and reactivates a bank account with audit rows, and blocks entity deactivation until then", async () => {
    const entity = await makeEntity();
    const number = await freeNumber();
    const bank = await createBankAccount(db, actor, {
      entityId: entity.id,
      newAccount: { number, name: "Checking" },
      name: "Main",
      kind: "CHECKING",
    });
    await expect(updateEntity(db, actor, entity.id, { isActive: false })).rejects.toThrow(
      /active bank account/i,
    );

    const off = await updateBankAccount(db, actor, bank.id, { isActive: false });
    expect(off.isActive).toBe(false);
    const on = await updateBankAccount(db, actor, bank.id, {
      isActive: true,
      institution: "Renamed Bank",
    });
    expect(on.isActive).toBe(true);
    expect(on.institution).toBe("Renamed Bank");
    const audits = await db.auditLog.findMany({
      where: { subjectType: "bank_account", subjectId: bank.id },
      orderBy: { id: "asc" },
    });
    expect(audits.map((a) => a.action)).toEqual([
      "bank_account.create",
      "bank_account.deactivate",
      "bank_account.reactivate",
    ]);
    expect((audits[1]?.before as { isActive: boolean }).isActive).toBe(true);
    expect((audits[1]?.after as { isActive: boolean }).isActive).toBe(false);
    expect(audits[1]?.subjectLabel).toBe(`${number} Main`);

    await expect(
      updateBankAccount(db, actor, bank.id, { openedOn: "2026-02-01", closedOn: "2026-01-01" }),
    ).rejects.toThrow(/earlier than the opened/i);

    await updateBankAccount(db, actor, bank.id, { isActive: false });
    const inactive = await updateEntity(db, actor, entity.id, { isActive: false });
    expect(inactive.isActive).toBe(false);
    const entityAudit = await db.auditLog.findFirst({
      where: { subjectType: "entity", subjectId: entity.id, action: "entity.deactivate" },
    });
    expect(entityAudit?.subjectLabel).toBe(entity.code);
  });

  it("creates and updates a bridge rule with validation and an audit trail", async () => {
    const payer = await makeEntity("Payer");
    const receiver = await makeEntity("Receiver");
    const distribution = await makeAccount("EQUITY", "Equity", "Test Distribution");
    const contribution = await makeAccount("EQUITY", "Equity", "Test Contribution");
    const dueFrom = await makeAccount("ASSET", "Other Current Assets", "Due from affiliate");

    await expect(
      upsertBridgeRule(db, actor, {
        payerEntityId: payer.id,
        receiverEntityId: payer.id,
        mode: "DISTRIBUTION_CONTRIBUTION",
        payerAccountId: distribution.id,
        receiverAccountId: contribution.id,
      }),
    ).rejects.toThrow(/must be different/i);
    await expect(
      upsertBridgeRule(db, actor, {
        payerEntityId: payer.id,
        receiverEntityId: receiver.id,
        mode: "DISTRIBUTION_CONTRIBUTION",
        payerAccountId: dueFrom.id,
        receiverAccountId: contribution.id,
      }),
    ).rejects.toThrow(/equity/i);

    const created = await upsertBridgeRule(db, actor, {
      payerEntityId: payer.id,
      receiverEntityId: receiver.id,
      mode: "DISTRIBUTION_CONTRIBUTION",
      payerAccountId: distribution.id,
      receiverAccountId: contribution.id,
    });
    expect(created.mode).toBe("DISTRIBUTION_CONTRIBUTION");

    const updated = await db.$transaction((tx) =>
      upsertBridgeRule(tx, actor, {
        payerEntityId: payer.id,
        receiverEntityId: receiver.id,
        mode: "INTERCOMPANY",
        payerAccountId: dueFrom.id,
        receiverAccountId: contribution.id,
      }),
    );
    expect(updated.id).toBe(created.id);
    expect(updated.mode).toBe("INTERCOMPANY");
    expect(updated.payerAccountId).toBe(dueFrom.id);

    const audits = await db.auditLog.findMany({
      where: { subjectType: "entity_bridge_rule", subjectId: created.id },
      orderBy: { id: "asc" },
    });
    expect(audits.map((a) => a.action)).toEqual(["bridge_rule.create", "bridge_rule.update"]);
    expect(audits[1]?.subjectLabel).toBe(`${payer.code} → ${receiver.code}`);
    expect(audits[1]?.userId).toBe(actor.userId);
    expect(audits[1]?.before).toMatchObject({
      mode: "DISTRIBUTION_CONTRIBUTION",
      payerAccount: `${distribution.number} Test Distribution`,
    });
    expect(audits[1]?.after).toMatchObject({
      mode: "INTERCOMPANY",
      payerAccount: `${dueFrom.number} Due from affiliate`,
    });
    // tidy up so tests that count the seeded rules (seed.test.ts) are not affected by this file
    await owner.entityBridgeRule.delete({ where: { id: created.id } });
  });

  it("validates entity codes and keeps them unique", async () => {
    await expect(
      createEntity(db, actor, { code: "x1", name: "Bad", taxForm: "FORM_1065" }),
    ).rejects.toThrow(/2 to 8 letters/i);
    const first = await makeEntity();
    await expect(
      createEntity(db, actor, {
        code: first.code.toLowerCase(),
        name: "Dup",
        taxForm: "FORM_1065",
      }),
    ).rejects.toThrow(/already exists/i);
    const renamed = await updateEntity(db, actor, first.id, {
      name: "Renamed",
      taxForm: "FORM_1120S",
    });
    expect(renamed.name).toBe("Renamed");
    expect(renamed.taxForm).toBe("FORM_1120S");
  });
});
