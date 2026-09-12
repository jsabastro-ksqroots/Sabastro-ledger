import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient, db, disconnectDb } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import {
  AccountError,
  createAccount,
  distinctParentGroups,
  listAccounts,
  setAccountActive,
  subTypeSuggestions,
  updateAccount,
} from "@/lib/org/accounts";

const owner = createPrismaClient(process.env.DATABASE_URL as string);
const meta = { ip: null, userAgent: "vitest", sessionId: null };

let actor: { userId: string; sessionId: string | null; role: "FULL"; ip: null; userAgent: string };
let counter = 0;
/** A 4-digit number that is unlikely to collide with the seed (which stays below 6000) or earlier tests. */
function freshNumber(): string {
  counter += 1;
  return String(6000 + ((Date.now() + counter * 7) % 3999));
}
const base = {
  parentGroup: "5200 Operating Expenses",
  type: "EXPENSE" as const,
  subType: "Expense",
  subType2: "Operating Expenses",
};

beforeAll(async () => {
  const user = await owner.user.create({
    data: {
      email: `acct-actor-${Date.now()}@test.local`,
      displayName: "Acct Actor",
      passwordHash: await hashPassword("Temporary-Password-123"),
      role: "FULL",
    },
  });
  actor = { userId: user.id, role: "FULL", ...meta };
});

afterAll(async () => {
  await owner.$disconnect();
  await disconnectDb();
});

describe("chart of accounts", () => {
  it("creates an account with a unique 4-digit number and writes an audit row", async () => {
    const number = freshNumber();
    const account = await db.$transaction((tx) =>
      createAccount(tx, actor, {
        number,
        name: `  Test Expense ${number}  `,
        ...base,
        subType2: "",
        note: "",
      }),
    );
    expect(account.number).toBe(number);
    expect(account.name).toBe(`Test Expense ${number}`);
    expect(account.subType2).toBe("Operating Expenses"); // defaulted from the parent group's name
    expect(account.note).toBeNull();
    expect(account.isActive).toBe(true);
    const rows = await db.auditLog.findMany({
      where: { subjectType: "account", subjectId: account.id },
    });
    expect(rows.map((r) => r.action)).toEqual(["account.create"]);
    expect(rows[0]?.subjectLabel).toBe(`${number} Test Expense ${number}`);
    expect(rows[0]?.userId).toBe(actor.userId);
    expect((rows[0]?.after as { number: string }).number).toBe(number);
  });

  it("rejects bad numbers, duplicate numbers and missing names with plain-English messages", async () => {
    await expect(
      createAccount(db, actor, { number: "123", name: "Short", ...base }),
    ).rejects.toThrow(/exactly 4 digits/);
    await expect(
      createAccount(db, actor, { number: "12345", name: "Long", ...base }),
    ).rejects.toThrow(AccountError);
    await expect(
      createAccount(db, actor, { number: "12a4", name: "Letters", ...base }),
    ).rejects.toThrow(/exactly 4 digits/);
    const number = freshNumber();
    await createAccount(db, actor, { number, name: "First", ...base });
    await expect(createAccount(db, actor, { number, name: "Second", ...base })).rejects.toThrow(
      /already used by “First”/,
    );
    await expect(
      createAccount(db, actor, { number: freshNumber(), name: "   ", ...base }),
    ).rejects.toThrow(/name/i);
    await expect(
      createAccount(db, actor, {
        number: freshNumber(),
        name: "No group",
        ...base,
        parentGroup: "",
      }),
    ).rejects.toThrow(/parent group/i);
    await expect(
      createAccount(db, actor, { number: freshNumber(), name: "No sub", ...base, subType: "" }),
    ).rejects.toThrow(/sub-type/i);
  });

  it("updates names and grouping (never the number) with before/after in the audit log", async () => {
    const number = freshNumber();
    const created = await createAccount(db, actor, { number, name: "Before", ...base });
    const updated = await db.$transaction((tx) =>
      updateAccount(tx, actor, created.id, {
        name: "After",
        parentGroup: "5300 Depreciation Expense",
        type: "EXPENSE",
        subType: "Expense",
        subType2: "Depreciation Expense",
        note: "moved",
      }),
    );
    expect(updated.number).toBe(number);
    expect(updated.name).toBe("After");
    expect(updated.parentGroup).toBe("5300 Depreciation Expense");
    const row = await db.auditLog.findFirst({
      where: { subjectType: "account", subjectId: created.id, action: "account.update" },
    });
    expect(row).not.toBeNull();
    expect((row?.before as { name: string }).name).toBe("Before");
    expect((row?.after as { name: string; note: string }).name).toBe("After");
    expect((row?.after as { note: string }).note).toBe("moved");
    await expect(updateAccount(db, actor, created.id, { name: "", ...base })).rejects.toThrow(
      AccountError,
    );
  });

  it("deactivates and reactivates, hiding inactive rows from the default list", async () => {
    const number = freshNumber();
    const created = await createAccount(db, actor, { number, name: "Toggle me", ...base });
    const off = await db.$transaction((tx) => setAccountActive(tx, actor, created.id, false));
    expect(off.isActive).toBe(false);
    expect((await listAccounts(db, { search: number })).map((a) => a.id)).not.toContain(created.id);
    expect(
      (await listAccounts(db, { search: number, includeInactive: true })).map((a) => a.id),
    ).toContain(created.id);
    // No-op when already in that state: no extra audit row.
    await setAccountActive(db, actor, created.id, false);
    const on = await setAccountActive(db, actor, created.id, true);
    expect(on.isActive).toBe(true);
    const actions = (
      await db.auditLog.findMany({
        where: { subjectType: "account", subjectId: created.id },
        orderBy: { id: "asc" },
      })
    ).map((r) => r.action);
    expect(actions).toEqual(["account.create", "account.deactivate", "account.reactivate"]);
  });

  it("refuses to deactivate an account behind an active bank account, then allows it once the bank account is inactive", async () => {
    const stamp = Date.now();
    const entity = await owner.entity.create({
      data: { code: `T${stamp % 1_000_000}`, name: "Test Entity", taxForm: "SCHEDULE_C" },
    });
    const number = freshNumber();
    const ledger = await createAccount(db, actor, {
      number,
      name: "Test Bank",
      parentGroup: "1100 Bank Accounts",
      type: "ASSET",
      subType: "Bank",
      subType2: "Bank Accounts",
    });
    const bank = await owner.bankAccount.create({
      data: { entityId: entity.id, accountId: ledger.id, name: "Test Checking", kind: "CHECKING" },
    });
    await expect(setAccountActive(db, actor, ledger.id, false)).rejects.toThrow(
      /Deactivate that bank account first/,
    );
    expect((await db.account.findUniqueOrThrow({ where: { id: ledger.id } })).isActive).toBe(true);
    await owner.bankAccount.update({ where: { id: bank.id }, data: { isActive: false } });
    const off = await setAccountActive(db, actor, ledger.id, false);
    expect(off.isActive).toBe(false);
  });

  it("refuses to deactivate an account that a cross-entity bridge rule uses", async () => {
    const stamp = Date.now();
    const payer = await owner.entity.create({
      data: { code: `P${stamp % 1_000_000}`, name: "Payer", taxForm: "FORM_1065" },
    });
    const receiver = await owner.entity.create({
      data: { code: `R${stamp % 1_000_000}`, name: "Receiver", taxForm: "SCHEDULE_C" },
    });
    const distribution = await createAccount(db, actor, {
      number: freshNumber(),
      name: "Test Distribution",
      parentGroup: "3100 Capital Flows",
      type: "EQUITY",
      subType: "Equity",
      subType2: "Capital Contributions",
    });
    const contribution = await createAccount(db, actor, {
      number: freshNumber(),
      name: "Test Contribution",
      parentGroup: "3100 Capital Flows",
      type: "EQUITY",
      subType: "Equity",
      subType2: "Capital Contributions",
    });
    await owner.entityBridgeRule.create({
      data: {
        payerEntityId: payer.id,
        receiverEntityId: receiver.id,
        payerAccountId: distribution.id,
        receiverAccountId: contribution.id,
      },
    });
    await expect(setAccountActive(db, actor, distribution.id, false)).rejects.toThrow(
      /bridge rule/,
    );
    await expect(setAccountActive(db, actor, contribution.id, false)).rejects.toThrow(
      /bridge rule/,
    );
    // Once the rule points elsewhere (here: is removed), deactivation is allowed. Also keeps the seed test's
    // global bridge-rule count intact, since every test file shares one database.
    await owner.entityBridgeRule.deleteMany({ where: { payerEntityId: payer.id } });
    await owner.entity.deleteMany({ where: { id: { in: [payer.id, receiver.id] } } });
    const off = await setAccountActive(db, actor, distribution.id, false);
    expect(off.isActive).toBe(false);
  });

  it("offers parent groups and sub-types from existing rows for the form", async () => {
    await createAccount(db, actor, {
      number: freshNumber(),
      name: "Odd one",
      parentGroup: "9900 Test Group",
      type: "EXPENSE",
      subType: "Test Sub",
      subType2: "Test Sub 2",
    });
    expect(await distinctParentGroups(db)).toContain("9900 Test Group");
    const s = await subTypeSuggestions(db);
    expect(s.subTypes).toContain("Test Sub");
    expect(s.subTypes).toContain("Bank");
    expect(s.subTypes2).toContain("Test Sub 2");
    expect(s.subTypes2).toContain("Operating Expenses");
  });
});
