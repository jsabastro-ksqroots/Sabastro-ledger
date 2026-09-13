import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient, db, disconnectDb } from "@/lib/db";
import { runSeed } from "@/lib/seed/run-seed";
import { createBankAccount, createEntity, updateBankAccount } from "@/lib/org/entities";
import { LedgerError, LockedYearError } from "@/lib/ledger/errors";
import {
  createBankTransaction,
  createJournalEntry,
  liveLines,
  postTransaction,
  setFlag,
  setLineAccountClass,
  splitLine,
  splitRootOf,
  unsplitLine,
  updateBankTransaction,
  updateJournalEntry,
  userLinesOf,
  voidTransaction,
  type LoadedTransaction,
} from "@/lib/ledger/transactions";
import { loadRefData } from "@/lib/ledger/ref-data";
import { addSystemNote, setUserNote } from "@/lib/ledger/notes";
import { getTransactionDetail, listLedgerRows, loadPickerData } from "@/lib/ledger/query";
import {
  closeTaxYear,
  fileTaxYear,
  getChecklist,
  reopenTaxYear,
  setChecklistItem,
} from "@/lib/ledger/tax-years";
import { deleteView, listSavedViews, saveView } from "@/lib/ledger/saved-views";

/**
 * The accounting core against a real database (the restricted app role). Runs the seed for the chart and
 * the shared General class, then works inside two throw-away entities so nothing about SREI/PLA changes.
 */
const owner = createPrismaClient(process.env.DATABASE_URL as string);
const meta = { ip: null, userAgent: "vitest", sessionId: null };
let actor: { userId: string; sessionId: null; ip: null; userAgent: string };
let TA: { id: string; code: string };
let TB: { id: string; code: string };
let bankA: string; // bank account id (entity TA)
let bankB: string; // bank account id (entity TB)
let bankAAccountId: string;
let bankBAccountId: string;
let clsA: string; // class of TA
let clsB: string; // class of TB
let clsA2: string; // second class of TA
let general: string;
let EXPENSE: string; // 5215
let INCOME: string; // 4101
let EXPENSE2: string; // 5217
let DEPR: string; // an expense account for adjusting entries
let A3101: string;
let A3102: string;

function uniqueCode(prefix: string): string {
  const letters = Date.now()
    .toString()
    .replace(/\d/g, (d) => String.fromCharCode(65 + Number(d)));
  return (
    prefix +
    letters.slice(-5) +
    String.fromCharCode(65 + Math.floor(Math.random() * 26))
  ).slice(0, 8);
}

async function freeNumber(): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const n = String(9000 + Math.floor(Math.random() * 1000));
    if (!(await owner.account.findUnique({ where: { number: n } }))) return n;
  }
  throw new Error("no free account number");
}

const run = <T>(fn: (tx: Parameters<Parameters<typeof db.$transaction>[0]>[0]) => Promise<T>) =>
  db.$transaction(fn);

function byAccount(t: LoadedTransaction, accountId: string) {
  return liveLines(t).filter((l) => l.accountId === accountId);
}

beforeAll(async () => {
  await runSeed(owner, { users: [], appDbPassword: null });
  const user = await owner.user.create({
    data: {
      email: `ledger-${Date.now()}@test.local`,
      displayName: "Ledger tester",
      passwordHash: "!test",
      role: "FULL",
    },
  });
  actor = { userId: user.id, ...meta };
  const a = await createEntity(owner, actor, {
    code: uniqueCode("TA"),
    name: "Test A",
    taxForm: "FORM_1065",
  });
  const b = await createEntity(owner, actor, {
    code: uniqueCode("TB"),
    name: "Test B",
    taxForm: "SCHEDULE_C",
  });
  TA = { id: a.id, code: a.code };
  TB = { id: b.id, code: b.code };
  const ba = await createBankAccount(owner, actor, {
    entityId: TA.id,
    newAccount: { number: await freeNumber(), name: "Test A checking" },
    name: "A checking",
    kind: "CHECKING",
  });
  const bb = await createBankAccount(owner, actor, {
    entityId: TB.id,
    newAccount: { number: await freeNumber(), name: "Test B checking" },
    name: "B checking",
    kind: "CHECKING",
  });
  bankA = ba.id;
  bankB = bb.id;
  bankAAccountId = ba.accountId;
  bankBAccountId = bb.accountId;
  const stamp = Date.now();
  clsA = (
    await owner.class.create({
      data: { name: `Test:Rental A ${stamp}`, entityId: TA.id, kind: "RENTAL" },
    })
  ).id;
  clsA2 = (
    await owner.class.create({
      data: { name: `Test:Rental A2 ${stamp}`, entityId: TA.id, kind: "RENTAL" },
    })
  ).id;
  clsB = (
    await owner.class.create({
      data: { name: `Test:Consulting B ${stamp}`, entityId: TB.id, kind: "BUSINESS" },
    })
  ).id;
  const acct = async (n: string) =>
    (await owner.account.findUniqueOrThrow({ where: { number: n } })).id;
  EXPENSE = await acct("5215");
  EXPENSE2 = await acct("5217");
  INCOME = await acct("4101");
  A3101 = await acct("3101");
  A3102 = await acct("3102");
  DEPR =
    (await owner.account.findFirst({ where: { subType2: "Depreciation Expense", isActive: true } }))
      ?.id ?? EXPENSE2;
  general = (await owner.class.findFirstOrThrow({ where: { isShared: true } })).id;
  for (const [payer, receiver] of [
    [TA.id, TB.id],
    [TB.id, TA.id],
  ]) {
    await owner.entityBridgeRule.create({
      data: {
        payerEntityId: payer as string,
        receiverEntityId: receiver as string,
        payerAccountId: A3102,
        receiverAccountId: A3101,
      },
    });
  }
  await owner.taxYear.createMany({
    data: [
      { entityId: TA.id, year: 2024, state: "CLOSED" },
      { entityId: TA.id, year: 2023, state: "FILED" },
      { entityId: TB.id, year: 2022, state: "CLOSED" },
    ],
  });
});

afterAll(async () => {
  // Tidy the bridge rules so seed.test.ts still counts exactly the two seeded ones.
  await owner.entityBridgeRule.deleteMany({
    where: { OR: [{ payerEntityId: TA.id }, { payerEntityId: TB.id }] },
  });
  await owner.$disconnect();
  await disconnectDb();
});

describe("simple rows", () => {
  it("posts money out as Dr account / Cr bank on one entity, with an audit row and a system note", async () => {
    const t = await run((tx) =>
      createBankTransaction(tx, actor, {
        bankAccountId: bankA,
        date: "2025-01-07",
        vendor: "McGovern",
        amountCents: -13515n,
        accountId: EXPENSE,
        classId: clsA,
        memo: "Lawn",
        userNote: "Second of three identical payments",
        post: true,
      }),
    );
    expect(t.status).toBe("POSTED");
    expect(t.kind).toBe("BANK");
    expect(t.entityId).toBe(TA.id);
    expect(Number(t.seq)).toBeGreaterThan(0);
    const live = liveLines(t);
    expect(live).toHaveLength(2);
    expect(byAccount(t, EXPENSE)[0]).toMatchObject({
      debitCents: 13515n,
      creditCents: 0n,
      classId: clsA,
      entityId: TA.id,
    });
    expect(byAccount(t, bankAAccountId)[0]).toMatchObject({
      debitCents: 0n,
      creditCents: 13515n,
      classId: clsA,
      entityId: TA.id,
    });
    expect(live.some((l) => l.isBridge)).toBe(false);
    const audits = await db.auditLog.findMany({
      where: { subjectType: "transaction", subjectId: t.id },
      orderBy: { id: "asc" },
    });
    expect(audits.map((a) => a.action)).toEqual(["transaction.create", "transaction.note"]);
    expect(audits[0]?.entityId).toBe(TA.id);
    const notes = await db.note.findMany({
      where: { transactionId: t.id },
      orderBy: { createdAt: "asc" },
    });
    expect(notes.map((n) => n.kind)).toEqual(["SYSTEM", "USER"]);
    expect(notes[1]?.body).toBe("Second of three identical payments");
  });

  it("posts money in as Dr bank / Cr account", async () => {
    const t = await run((tx) =>
      createBankTransaction(tx, actor, {
        bankAccountId: bankA,
        date: "2025-02-01",
        vendor: "Tenant",
        amountCents: 90000n,
        accountId: INCOME,
        classId: clsA,
        post: true,
      }),
    );
    expect(byAccount(t, bankAAccountId)[0]).toMatchObject({ debitCents: 90000n, creditCents: 0n });
    expect(byAccount(t, INCOME)[0]).toMatchObject({ debitCents: 0n, creditCents: 90000n });
  });

  it("refuses zero amounts, the bank's own account, inactive classes and missing vendors", async () => {
    const base = {
      bankAccountId: bankA,
      date: "2025-02-01",
      vendor: "X",
      accountId: EXPENSE,
      classId: clsA,
      post: true,
    };
    await expect(
      run((tx) => createBankTransaction(tx, actor, { ...base, amountCents: 0n })),
    ).rejects.toThrow(/cannot be zero/);
    await expect(
      run((tx) =>
        createBankTransaction(tx, actor, {
          ...base,
          amountCents: -100n,
          accountId: bankAAccountId,
        }),
      ),
    ).rejects.toThrow(/already runs through/);
    await expect(
      run((tx) => createBankTransaction(tx, actor, { ...base, amountCents: -100n, vendor: "  " })),
    ).rejects.toThrow(/vendor/i);
    await expect(
      run((tx) =>
        createBankTransaction(tx, actor, { ...base, amountCents: -100n, date: "2025-02-30" }),
      ),
    ).rejects.toThrow(/not a real date/);
  });

  it("edits vendor, date, amount, account and class by superseding the old lines (history kept)", async () => {
    const t = await run((tx) =>
      createBankTransaction(tx, actor, {
        bankAccountId: bankA,
        date: "2025-03-01",
        vendor: "Lowes #02405",
        amountCents: -5000n,
        accountId: EXPENSE,
        classId: clsA,
        post: true,
      }),
    );
    const edited = await run((tx) =>
      updateBankTransaction(tx, actor, t.id, {
        vendor: "Lowes",
        date: "2025-03-02",
        amountCents: -7500n,
        classId: clsA2,
      }),
    );
    expect(edited.vendor).toBe("Lowes");
    expect(edited.date.toISOString().slice(0, 10)).toBe("2025-03-02");
    expect(liveLines(edited)).toHaveLength(2);
    expect(byAccount(edited, EXPENSE).find((l) => !l.supersededAt)).toMatchObject({
      debitCents: 7500n,
      classId: clsA2,
    });
    expect(edited.lines).toHaveLength(4);
    const superseded = edited.lines.filter((l) => l.supersededAt);
    expect(superseded).toHaveLength(2);
    const auditRow = await db.auditLog.findFirst({
      where: { subjectId: t.id, action: "transaction.update" },
    });
    expect(auditRow).not.toBeNull();
    expect(superseded.every((l) => l.supersededByAuditId === auditRow?.id)).toBe(true);
    expect((auditRow?.before as { vendor: string }).vendor).toBe("Lowes #02405");
    expect((auditRow?.after as { vendor: string }).vendor).toBe("Lowes");
    // An unchanged edit keeps every line as it is.
    const same = await run((tx) => updateBankTransaction(tx, actor, t.id, { memo: "note" }));
    expect(same.lines).toHaveLength(4);
  });
});

describe("transfers between own bank accounts", () => {
  it("same entity: the other bank's line is the editable account line, the amount is the movement, and there is no bridge", async () => {
    // A second bank account of TA, so the transfer stays inside one entity.
    const a2 = await createBankAccount(owner, actor, {
      entityId: TA.id,
      newAccount: { number: await freeNumber(), name: "Test A savings" },
      name: "A savings",
      kind: "SAVINGS",
    });
    const t = await run((tx) =>
      createBankTransaction(tx, actor, {
        bankAccountId: bankA,
        date: "2025-08-03",
        vendor: "Transfer from savings",
        amountCents: 20020n,
        accountId: a2.accountId,
        classId: clsA,
        post: true,
      }),
    );
    const live = liveLines(t);
    expect(live).toHaveLength(2);
    expect(live.some((l) => l.isBridge)).toBe(false);
    expect(byAccount(t, bankAAccountId)[0]).toMatchObject({ debitCents: 20020n, entityId: TA.id });
    expect(byAccount(t, a2.accountId)[0]).toMatchObject({ creditCents: 20020n, entityId: TA.id });
    const ref = await loadRefData(db);
    const user = userLinesOf(ref, t);
    expect(user).toHaveLength(1);
    expect(user[0]?.accountId).toBe(a2.accountId);
    const rows = await listLedgerRows(db, { entityId: TA.id, year: 2025 });
    const row = rows.find((r) => r.id === t.id)!;
    expect(row.amountCents).toBe(20020);
    expect(row.primaryLineId).toBe(user[0]!.id);
    expect(row.accountLabel).toContain("Test A savings");
    expect(row.isSplit).toBe(false);
    expect(row.lines.find((l) => l.accountId === a2.accountId)).toMatchObject({
      isBank: true,
      isDerived: false,
    });
    expect(row.lines.find((l) => l.accountId === bankAAccountId)).toMatchObject({
      isBank: true,
      isDerived: true,
    });
    // The simple-row editor can change it (the earlier code saw "0 user lines" here).
    const edited = await run((tx) =>
      updateBankTransaction(tx, actor, t.id, {
        amountCents: -5000n,
        accountId: EXPENSE,
        classId: clsA2,
      }),
    );
    expect(userLinesOf(ref, edited)).toHaveLength(1);
    expect(userLinesOf(ref, edited)[0]).toMatchObject({ accountId: EXPENSE, debitCents: 5000n });
    expect(liveLines(edited)).toHaveLength(2);
    const rows2 = await listLedgerRows(db, { entityId: TA.id, year: 2025 });
    expect(rows2.find((r) => r.id === t.id)?.amountCents).toBe(-5000);
  });

  it("across entities: the transfer gets the usual bridge, and the amount follows the row's own bank", async () => {
    const t = await run((tx) =>
      createBankTransaction(tx, actor, {
        bankAccountId: bankA,
        date: "2025-08-04",
        vendor: "Transfer from B",
        amountCents: 20020n,
        accountId: bankBAccountId,
        classId: clsA,
        post: true,
      }),
    );
    const live = liveLines(t);
    expect(live).toHaveLength(4);
    const bridge = live.filter((l) => l.isBridge);
    expect(bridge).toHaveLength(2);
    expect(bridge.find((l) => l.entityId === TB.id)).toMatchObject({
      accountId: A3102,
      classId: general,
      debitCents: 20020n,
    });
    expect(bridge.find((l) => l.entityId === TA.id)).toMatchObject({
      accountId: A3101,
      classId: clsA,
      creditCents: 20020n,
    });
    const ref = await loadRefData(db);
    expect(userLinesOf(ref, t)[0]).toMatchObject({
      accountId: bankBAccountId,
      creditCents: 20020n,
      entityId: TB.id,
    });
    const rows = await listLedgerRows(db, { entityId: TB.id, year: 2025 });
    expect(rows.find((r) => r.id === t.id)?.amountCents).toBe(20020);
  });

  it("a journal entry keeps a cash amount when it touches exactly one bank account", async () => {
    const one = await run((tx) =>
      createJournalEntry(tx, actor, {
        entityId: TA.id,
        date: "2025-08-05",
        vendor: "Opening contribution",
        adjusting: false,
        lines: [
          { accountId: bankAAccountId, classId: general, debitCents: 100000n, creditCents: 0n },
          { accountId: A3101, classId: general, debitCents: 0n, creditCents: 100000n },
        ],
        post: true,
      }),
    );
    const rows = await listLedgerRows(db, { entityId: TA.id, year: 2025 });
    expect(rows.find((r) => r.id === one.id)?.amountCents).toBe(100000);
    const noBank = rows.find((r) => r.kind === "ADJUSTING" && r.vendor === "Depreciation 2025");
    if (noBank) expect(noBank.amountCents).toBeNull();
  });

  it("refuses a closed bank account as a new counterpart after its closing date, but keeps existing rows editable", async () => {
    const a3 = await createBankAccount(owner, actor, {
      entityId: TA.id,
      newAccount: { number: await freeNumber(), name: "Test A money market" },
      name: "A money market",
      kind: "SAVINGS",
    });
    const sweep = {
      bankAccountId: bankA,
      vendor: "Sweep",
      amountCents: -30000n,
      accountId: a3.accountId,
      classId: clsA,
      post: true,
    };
    const before = await run((tx) =>
      createBankTransaction(tx, actor, { ...sweep, date: "2025-08-06" }),
    );
    await updateBankAccount(owner, actor, a3.id, { isActive: false, closedOn: "2025-08-31" });
    await expect(
      run((tx) => createBankTransaction(tx, actor, { ...sweep, date: "2025-09-01" })),
    ).rejects.toThrow(/closed bank account \(closed 2025-08-31\)/);
    const early = await run((tx) =>
      createBankTransaction(tx, actor, { ...sweep, date: "2025-08-15" }),
    );
    expect(early.status).toBe("POSTED");
    const renamed = await run((tx) =>
      updateBankTransaction(tx, actor, before.id, { vendor: "Sweep to money market" }),
    );
    expect(renamed.vendor).toBe("Sweep to money market");
    const other = await run((tx) =>
      createBankTransaction(tx, actor, {
        bankAccountId: bankA,
        date: "2025-09-02",
        vendor: "Fees",
        amountCents: -100n,
        accountId: EXPENSE,
        classId: clsA,
        post: true,
      }),
    );
    const ref = await loadRefData(db);
    await expect(
      run((tx) =>
        setLineAccountClass(tx, actor, userLinesOf(ref, other)[0]!.id, { accountId: a3.accountId }),
      ),
    ).rejects.toThrow(/closed bank account/);
  });

  it("marks the ledger accounts of closed bank accounts so the pickers can hide them", async () => {
    const closed = await createBankAccount(owner, actor, {
      entityId: TA.id,
      newAccount: { number: await freeNumber(), name: "Test A old checking" },
      name: "A old checking",
      kind: "CHECKING",
    });
    await updateBankAccount(owner, actor, closed.id, { isActive: false });
    const picker = await loadPickerData(db);
    expect(picker.accounts.find((a) => a.id === closed.accountId)).toMatchObject({
      isBank: true,
      isClosedBank: true,
    });
    expect(picker.accounts.find((a) => a.id === bankAAccountId)).toMatchObject({
      isBank: true,
      isClosedBank: false,
    });
    expect(picker.accounts.find((a) => a.id === EXPENSE)).toMatchObject({
      isBank: false,
      isClosedBank: false,
    });
  });
});

describe("cross-entity bridge in the database", () => {
  it("TA's bank paying a TB expense balances both entities with two bridge lines", async () => {
    const t = await run((tx) =>
      createBankTransaction(tx, actor, {
        bankAccountId: bankA,
        date: "2025-04-01",
        vendor: "Comply",
        amountCents: -10000n,
        accountId: EXPENSE,
        classId: clsB,
        post: true,
      }),
    );
    const live = liveLines(t);
    expect(live).toHaveLength(4);
    const bridge = live.filter((l) => l.isBridge);
    expect(bridge).toHaveLength(2);
    expect(bridge.find((l) => l.entityId === TA.id)).toMatchObject({
      accountId: A3102,
      classId: general,
      debitCents: 10000n,
    });
    expect(bridge.find((l) => l.entityId === TB.id)).toMatchObject({
      accountId: A3101,
      classId: clsB,
      creditCents: 10000n,
    });
    expect(byAccount(t, EXPENSE)[0]?.entityId).toBe(TB.id);
    expect(byAccount(t, bankAAccountId)[0]).toMatchObject({ entityId: TA.id, classId: clsB });
    for (const entity of [TA.id, TB.id]) {
      const mine = live.filter((l) => l.entityId === entity);
      const dr = mine.reduce((s, l) => s + l.debitCents, 0n);
      const cr = mine.reduce((s, l) => s + l.creditCents, 0n);
      expect(dr).toBe(cr);
    }
    // It shows up in both entities' ledgers.
    const rowsA = await listLedgerRows(db, { entityId: TA.id, year: 2025 });
    const rowsB = await listLedgerRows(db, { entityId: TB.id, year: 2025 });
    expect(rowsA.find((r) => r.id === t.id)?.isCrossEntity).toBe(true);
    expect(rowsB.find((r) => r.id === t.id)?.entityCodes.sort()).toEqual([TA.code, TB.code].sort());
    expect(rowsA.find((r) => r.id === t.id)?.amountCents).toBe(-10000);
  });

  it("money in for TB landing in TA's bank makes TB the payer and TA the receiver", async () => {
    const t = await run((tx) =>
      createBankTransaction(tx, actor, {
        bankAccountId: bankA,
        date: "2025-04-02",
        vendor: "Client",
        amountCents: 50000n,
        accountId: INCOME,
        classId: clsB,
        post: true,
      }),
    );
    const bridge = liveLines(t).filter((l) => l.isBridge);
    expect(bridge.find((l) => l.entityId === TB.id)).toMatchObject({
      accountId: A3102,
      classId: general,
      debitCents: 50000n,
    });
    expect(bridge.find((l) => l.entityId === TA.id)).toMatchObject({
      accountId: A3101,
      classId: clsB,
      creditCents: 50000n,
    });
  });

  it("regenerates the bridge when an inline class edit moves a line to another entity", async () => {
    const t = await run((tx) =>
      createBankTransaction(tx, actor, {
        bankAccountId: bankA,
        date: "2025-04-03",
        vendor: "Staples",
        amountCents: -2500n,
        accountId: EXPENSE,
        classId: clsA,
        post: true,
      }),
    );
    expect(liveLines(t)).toHaveLength(2);
    const ref = await loadRefData(db);
    const line = userLinesOf(ref, t)[0]!;
    const after = await run((tx) => setLineAccountClass(tx, actor, line.id, { classId: clsB }));
    expect(liveLines(after)).toHaveLength(4);
    expect(liveLines(after).filter((l) => l.isBridge)).toHaveLength(2);
    expect(userLinesOf(ref, after)[0]).toMatchObject({
      classId: clsB,
      entityId: TB.id,
      debitCents: 2500n,
    });
    const back = await run((tx) =>
      setLineAccountClass(tx, actor, userLinesOf(ref, after)[0]!.id, {
        classId: clsA,
        accountId: EXPENSE2,
      }),
    );
    expect(liveLines(back)).toHaveLength(2);
    expect(userLinesOf(ref, back)[0]).toMatchObject({
      classId: clsA,
      accountId: EXPENSE2,
      entityId: TA.id,
    });
    await expect(
      run((tx) =>
        setLineAccountClass(
          tx,
          actor,
          liveLines(back).find((l) => l.accountId === bankAAccountId)!.id,
          { classId: clsB },
        ),
      ),
    ).rejects.toThrow(/bank line follows/);
  });
});

describe("splits", () => {
  it("splits by amount into classes of two entities, derives bank lines per class and bridges the foreign share, then unsplits", async () => {
    const t = await run((tx) =>
      createBankTransaction(tx, actor, {
        bankAccountId: bankA,
        date: "2025-05-01",
        vendor: "Fuel",
        amountCents: -10000n,
        accountId: EXPENSE,
        classId: clsA,
        post: true,
      }),
    );
    const ref = await loadRefData(db);
    const primary = userLinesOf(ref, t)[0]!;
    const split = await run((tx) =>
      splitLine(
        tx,
        actor,
        primary.id,
        [
          { accountId: EXPENSE, classId: clsA, amountCents: 6000n },
          { accountId: EXPENSE, classId: clsB, amountCents: 4000n, memo: "B share" },
        ],
        "amount",
      ),
    );
    const live = liveLines(split);
    const user = userLinesOf(ref, split);
    expect(user).toHaveLength(2);
    expect(user.every((l) => l.parentLineId === primary.id)).toBe(true);
    expect(split.lines.find((l) => l.id === primary.id)?.supersededAt).not.toBeNull();
    const bank = live.filter((l) => l.accountId === bankAAccountId);
    expect(bank.map((l) => [l.classId, l.creditCents]).sort()).toEqual(
      [
        [clsA, 6000n],
        [clsB, 4000n],
      ].sort(),
    );
    const bridge = live.filter((l) => l.isBridge);
    expect(bridge.find((l) => l.entityId === TA.id)?.debitCents).toBe(4000n);
    expect(bridge.find((l) => l.entityId === TB.id)).toMatchObject({
      classId: clsB,
      creditCents: 4000n,
    });
    expect(live).toHaveLength(6);
    expect(splitRootOf(split, user[0]!).id).toBe(primary.id);

    const rows = await listLedgerRows(db, { entityId: TA.id, year: 2025 });
    const row = rows.find((r) => r.id === t.id)!;
    expect(row.isSplit).toBe(true);
    expect(row.accountLabel).toBe("5215 Supplies Expense");
    expect(row.classLabel).toBe("Split (2)");
    expect(row.splitRootLineId).toBe(primary.id);
    expect(row.amountCents).toBe(-10000);

    const unsplit = await run((tx) => unsplitLine(tx, actor, primary.id, { classId: clsA2 }));
    const single = userLinesOf(ref, unsplit);
    expect(single).toHaveLength(1);
    expect(single[0]).toMatchObject({
      debitCents: 10000n,
      classId: clsA2,
      parentLineId: primary.id,
    });
    expect(liveLines(unsplit)).toHaveLength(2);
    expect(unsplit.lines.length).toBeGreaterThanOrEqual(8);
    const audits = await db.auditLog.findMany({
      where: { subjectId: t.id },
      orderBy: { id: "asc" },
      select: { action: true },
    });
    expect(audits.map((a) => a.action)).toEqual([
      "transaction.create",
      "transaction.split",
      "transaction.unsplit",
    ]);
  });

  it("splits by percent to the cent", async () => {
    const t = await run((tx) =>
      createBankTransaction(tx, actor, {
        bankAccountId: bankA,
        date: "2025-05-02",
        vendor: "Insurance",
        amountCents: -10001n,
        accountId: EXPENSE,
        classId: clsA,
        post: true,
      }),
    );
    const ref = await loadRefData(db);
    const primary = userLinesOf(ref, t)[0]!;
    const split = await run((tx) =>
      splitLine(
        tx,
        actor,
        primary.id,
        [
          { accountId: EXPENSE, classId: clsA, percentBp: 3333 },
          { accountId: EXPENSE, classId: clsA2, percentBp: 3333 },
          { accountId: EXPENSE2, classId: clsA, percentBp: 3334 },
        ],
        "percent",
      ),
    );
    const parts = userLinesOf(ref, split).map((l) => l.debitCents);
    expect(parts.reduce((a, b) => a + b, 0n)).toBe(10001n);
    expect(parts).toEqual([3333n, 3333n, 3335n]);
  });

  it("rejects splits that do not add up and refuses to edit the amount of a split row", async () => {
    const t = await run((tx) =>
      createBankTransaction(tx, actor, {
        bankAccountId: bankA,
        date: "2025-05-03",
        vendor: "Amazon",
        amountCents: -3000n,
        accountId: EXPENSE,
        classId: clsA,
        post: true,
      }),
    );
    const ref = await loadRefData(db);
    const primary = userLinesOf(ref, t)[0]!;
    await expect(
      run((tx) =>
        splitLine(
          tx,
          actor,
          primary.id,
          [
            { accountId: EXPENSE, classId: clsA, amountCents: 1000n },
            { accountId: EXPENSE, classId: clsA2, amountCents: 1000n },
          ],
          "amount",
        ),
      ),
    ).rejects.toThrow(/still to allocate/);
    await run((tx) =>
      splitLine(
        tx,
        actor,
        primary.id,
        [
          { accountId: EXPENSE, classId: clsA, amountCents: 1000n },
          { accountId: EXPENSE, classId: clsA2, amountCents: 2000n },
        ],
        "amount",
      ),
    );
    await expect(
      run((tx) => updateBankTransaction(tx, actor, t.id, { amountCents: -4000n })),
    ).rejects.toThrow(/split into 2 lines/);
    const renamed = await run((tx) =>
      updateBankTransaction(tx, actor, t.id, { vendor: "Amazon.com" }),
    );
    expect(renamed.vendor).toBe("Amazon.com");
    expect(userLinesOf(ref, renamed)).toHaveLength(2);
  });
});

describe("journal entries", () => {
  it("posts an adjusting depreciation entry and rejects an unbalanced one", async () => {
    const t = await run((tx) =>
      createJournalEntry(tx, actor, {
        entityId: TA.id,
        date: "2025-12-31",
        vendor: "Depreciation 2025",
        adjusting: true,
        lines: [
          { accountId: DEPR, classId: clsA, debitCents: 600000n, creditCents: 0n },
          { accountId: A3102, classId: general, debitCents: 0n, creditCents: 600000n },
        ],
        post: true,
      }),
    );
    expect(t.kind).toBe("ADJUSTING");
    expect(t.status).toBe("POSTED");
    expect(liveLines(t)).toHaveLength(2);
    await expect(
      run((tx) =>
        createJournalEntry(tx, actor, {
          entityId: TA.id,
          date: "2025-12-31",
          vendor: "Oops",
          adjusting: false,
          lines: [
            { accountId: DEPR, classId: clsA, debitCents: 100n, creditCents: 0n },
            { accountId: A3102, classId: general, debitCents: 0n, creditCents: 90n },
          ],
          post: true,
        }),
      ),
    ).rejects.toThrow(/does not balance/);
  });

  it("bridges a journal that spans entities, and a transfer between the two banks", async () => {
    const t = await run((tx) =>
      createJournalEntry(tx, actor, {
        entityId: TA.id,
        date: "2025-06-15",
        vendor: "Transfer A → B",
        adjusting: false,
        lines: [
          { accountId: bankBAccountId, classId: general, debitCents: 20000n, creditCents: 0n },
          { accountId: bankAAccountId, classId: general, debitCents: 0n, creditCents: 20000n },
        ],
        post: true,
      }),
    );
    const live = liveLines(t);
    expect(live).toHaveLength(4);
    expect(live.find((l) => l.accountId === bankBAccountId)?.entityId).toBe(TB.id);
    expect(live.find((l) => l.isBridge && l.entityId === TA.id)).toMatchObject({
      accountId: A3102,
      debitCents: 20000n,
    });
    expect(live.find((l) => l.isBridge && l.entityId === TB.id)).toMatchObject({
      accountId: A3101,
      creditCents: 20000n,
    });
  });

  it("keeps a draft journal incomplete until posting, then posts it", async () => {
    const draft = await run((tx) =>
      createJournalEntry(tx, actor, {
        entityId: TA.id,
        date: "2025-07-01",
        vendor: "Reclass",
        adjusting: false,
        lines: [
          { accountId: EXPENSE, classId: null, debitCents: 100n, creditCents: 0n },
          { accountId: EXPENSE2, classId: clsA, debitCents: 0n, creditCents: 100n },
        ],
        post: false,
      }),
    );
    expect(draft.status).toBe("DRAFT");
    await expect(run((tx) => postTransaction(tx, actor, draft.id))).rejects.toThrow(
      /still needs an account and a class/,
    );
    const ref = await loadRefData(db);
    const incomplete = userLinesOf(ref, draft).find((l) => !l.classId)!;
    await run((tx) => setLineAccountClass(tx, actor, incomplete.id, { classId: clsA }));
    const posted = await run((tx) => postTransaction(tx, actor, draft.id));
    expect(posted.status).toBe("POSTED");
    expect(posted.postedById).toBe(actor.userId);
    const flagged = await run((tx) => setFlag(tx, actor, draft.id, true, "why")).catch(
      (e: Error) => e,
    );
    expect(flagged).toBeInstanceOf(LedgerError);
    const edited = await run((tx) =>
      updateJournalEntry(tx, actor, draft.id, { vendor: "Reclass (edited)" }),
    );
    expect(edited.vendor).toBe("Reclass (edited)");
  });
});

describe("void", () => {
  it("needs a reason, keeps the lines untouched, and blocks every later change", async () => {
    const t = await run((tx) =>
      createBankTransaction(tx, actor, {
        bankAccountId: bankA,
        date: "2025-08-01",
        vendor: "Dup",
        amountCents: -100n,
        accountId: EXPENSE,
        classId: clsA,
        post: true,
      }),
    );
    await expect(run((tx) => voidTransaction(tx, actor, t.id, " "))).rejects.toThrow(/reason/i);
    const voided = await run((tx) => voidTransaction(tx, actor, t.id, "Duplicate of #1"));
    expect(voided.status).toBe("VOIDED");
    expect(voided.voidReason).toBe("Duplicate of #1");
    expect(voided.voidedById).toBe(actor.userId);
    expect(voided.lines.map((l) => [l.id, l.supersededAt])).toEqual(
      t.lines.map((l) => [l.id, null]),
    );
    await expect(run((tx) => voidTransaction(tx, actor, t.id, "again"))).rejects.toThrow(
      /already voided/,
    );
    await expect(
      run((tx) => updateBankTransaction(tx, actor, t.id, { vendor: "x" })),
    ).rejects.toThrow(/voided/);
    await expect(run((tx) => postTransaction(tx, actor, t.id))).rejects.toThrow(/voided/);
    const audits = await db.auditLog.findMany({
      where: { subjectId: t.id, action: "transaction.void" },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]?.reason).toBe("Duplicate of #1");
    // Nothing is ever deleted: the app role cannot delete a transaction at all.
    await expect(db.transaction.delete({ where: { id: t.id } })).rejects.toThrow();
    const rows = await listLedgerRows(db, { entityId: TA.id, year: 2025 });
    expect(rows.find((r) => r.id === t.id)?.status).toBe("VOIDED");
  });
});

describe("tax-year lock", () => {
  it("blocks posting into a closed year until a reason is given, then records the override", async () => {
    const input = {
      bankAccountId: bankA,
      date: "2024-05-01",
      vendor: "Late find",
      amountCents: -100n,
      accountId: EXPENSE,
      classId: clsA,
      post: true,
    };
    const err = await run((tx) => createBankTransaction(tx, actor, input)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LockedYearError);
    expect((err as LockedYearError).years).toEqual([
      expect.objectContaining({ entityCode: TA.code, year: 2024, state: "CLOSED" }),
    ]);
    const t = await run((tx) =>
      createBankTransaction(tx, actor, input, {
        lockOverrideReason: "Found a missing receipt after close",
      }),
    );
    expect(t.status).toBe("POSTED");
    const year = await db.taxYear.findUniqueOrThrow({
      where: { entityId_year: { entityId: TA.id, year: 2024 } },
    });
    expect(year.overrideCount).toBe(1);
    expect(year.state).toBe("CLOSED");
    const override = await db.auditLog.findFirst({
      where: { action: "tax_year.override", taxYearId: year.id },
      orderBy: { id: "desc" },
    });
    expect(override?.isLockOverride).toBe(true);
    expect(override?.reason).toBe("Found a missing receipt after close");
    // Drafts in a closed year are fine without a reason.
    const draft = await run((tx) => createBankTransaction(tx, actor, { ...input, post: false }));
    expect(draft.status).toBe("DRAFT");
    await expect(run((tx) => postTransaction(tx, actor, draft.id))).rejects.toThrow(
      LockedYearError,
    );
    // Voiding the posted one is locked too; the reason unlocks it.
    await expect(run((tx) => voidTransaction(tx, actor, t.id, "wrong year"))).rejects.toThrow(
      LockedYearError,
    );
    await run((tx) =>
      voidTransaction(tx, actor, t.id, "wrong year", {
        lockOverrideReason: "Entered in the wrong year",
      }),
    );
    expect((await db.taxYear.findUniqueOrThrow({ where: { id: year.id } })).overrideCount).toBe(2);
  });

  it("locks a date change into a filed year, in both directions", async () => {
    const t = await run((tx) =>
      createBankTransaction(tx, actor, {
        bankAccountId: bankA,
        date: "2025-09-01",
        vendor: "Move me",
        amountCents: -100n,
        accountId: EXPENSE,
        classId: clsA,
        post: true,
      }),
    );
    const err = await run((tx) =>
      updateBankTransaction(tx, actor, t.id, { date: "2023-09-01" }),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LockedYearError);
    expect((err as LockedYearError).years[0]).toMatchObject({ year: 2023, state: "FILED" });
    const moved = await run((tx) =>
      updateBankTransaction(
        tx,
        actor,
        t.id,
        { date: "2023-09-01" },
        { lockOverrideReason: "Belongs to 2023 after all" },
      ),
    );
    expect(moved.date.getUTCFullYear()).toBe(2023);
    await expect(
      run((tx) => updateBankTransaction(tx, actor, t.id, { vendor: "still locked" })),
    ).rejects.toThrow(LockedYearError);
  });

  it("checks every entity involved: TA's open 2022 paying TB's closed 2022 is locked", async () => {
    const input = {
      bankAccountId: bankA,
      date: "2022-03-01",
      vendor: "Cross",
      amountCents: -100n,
      accountId: EXPENSE,
      classId: clsB,
      post: true,
    };
    const err = await run((tx) => createBankTransaction(tx, actor, input)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LockedYearError);
    expect((err as LockedYearError).years).toEqual([
      expect.objectContaining({ entityCode: TB.code, year: 2022 }),
    ]);
    // The failed write rolled back, so nothing was created on demand yet.
    expect(
      await db.taxYear.findUnique({ where: { entityId_year: { entityId: TA.id, year: 2022 } } }),
    ).toBeNull();
    const same = { ...input, classId: clsA };
    const ok = await run((tx) => createBankTransaction(tx, actor, same));
    expect(ok.status).toBe("POSTED");
    const ta2022 = await db.taxYear.findUnique({
      where: { entityId_year: { entityId: TA.id, year: 2022 } },
    });
    expect(ta2022?.state).toBe("OPEN"); // created on demand by the successful write
  });

  it("the database itself refuses the write without the override setting", async () => {
    const t = await owner.transaction.findFirst({
      where: {
        entityId: TA.id,
        status: { in: ["POSTED", "VOIDED"] },
        date: { gte: new Date("2024-01-01"), lt: new Date("2025-01-01") },
      },
    });
    expect(t).not.toBeNull();
    await expect(
      owner.transaction.update({ where: { id: t!.id }, data: { memo: "sneaky" } }),
    ).rejects.toThrow(/LOCKED_YEAR/);
  });
});

describe("invariants enforced by the database", () => {
  it("rejects unbalanced, single-line, negative and double-sided lines even from the owner connection", async () => {
    const head = {
      entityId: TA.id,
      date: new Date("2025-10-01T00:00:00Z"),
      vendor: "Direct",
      status: "DRAFT" as const,
      kind: "BANK" as const,
      bankAccountId: bankA,
    };
    await expect(
      owner.transaction.create({
        data: {
          ...head,
          lines: {
            create: [
              { lineNo: 1, accountId: EXPENSE, classId: clsA, entityId: TA.id, debitCents: 100n },
              {
                lineNo: 2,
                accountId: bankAAccountId,
                classId: clsA,
                entityId: TA.id,
                creditCents: 90n,
              },
            ],
          },
        },
      }),
    ).rejects.toThrow(/does not balance/);
    await expect(
      owner.transaction.create({
        data: {
          ...head,
          lines: {
            create: [
              {
                lineNo: 1,
                accountId: EXPENSE,
                classId: clsA,
                entityId: TA.id,
                debitCents: 100n,
                creditCents: 100n,
              },
            ],
          },
        },
      }),
    ).rejects.toThrow(/transaction_lines_amounts/);
    await expect(owner.transaction.create({ data: head })).rejects.toThrow(/at least two lines/);
    await expect(
      owner.transaction.create({
        data: {
          ...head,
          lines: {
            create: [
              { lineNo: 1, accountId: EXPENSE, classId: clsA, entityId: TA.id, debitCents: -5n },
              {
                lineNo: 2,
                accountId: bankAAccountId,
                classId: clsA,
                entityId: TA.id,
                creditCents: -5n,
              },
            ],
          },
        },
      }),
    ).rejects.toThrow(/transaction_lines_amounts/);
  });

  it("never lets a posted transaction's lines be deleted or edited in place", async () => {
    const t = await run((tx) =>
      createBankTransaction(tx, actor, {
        bankAccountId: bankA,
        date: "2025-10-02",
        vendor: "Immutable",
        amountCents: -100n,
        accountId: EXPENSE,
        classId: clsA,
        post: true,
      }),
    );
    const line = liveLines(t)[0]!;
    await expect(owner.transactionLine.delete({ where: { id: line.id } })).rejects.toThrow(
      /never deleted/,
    );
    await expect(
      owner.transactionLine.update({ where: { id: line.id }, data: { debitCents: 1n } }),
    ).rejects.toThrow(/cannot be changed/);
    await expect(
      db.transactionLine.deleteMany({ where: { transactionId: t.id } }),
    ).rejects.toThrow();
  });

  it("keeps system notes append-only and user notes editable with an audit row", async () => {
    const t = await run((tx) =>
      createBankTransaction(tx, actor, {
        bankAccountId: bankA,
        date: "2025-10-03",
        vendor: "Notes",
        amountCents: -100n,
        accountId: EXPENSE,
        classId: clsA,
        post: true,
      }),
    );
    await run((tx) => addSystemNote(tx, t.id, "Matched to statement line 12", actor.userId));
    const sys = await db.note.findFirst({
      where: { transactionId: t.id, kind: "SYSTEM", body: { contains: "statement" } },
    });
    await expect(
      owner.note.update({ where: { id: sys!.id }, data: { body: "tampered" } }),
    ).rejects.toThrow(/append-only/);
    await expect(owner.note.delete({ where: { id: sys!.id } })).rejects.toThrow(/append-only/);
    await run((tx) => setUserNote(tx, actor, t.id, "Ask Jose"));
    await run((tx) => setUserNote(tx, actor, t.id, "Jose says supplies"));
    const notes = await db.note.findMany({ where: { transactionId: t.id, kind: "USER" } });
    expect(notes).toHaveLength(1);
    expect(notes[0]?.body).toBe("Jose says supplies");
    const audits = await db.auditLog.findMany({
      where: { subjectId: t.id, action: "transaction.note" },
      orderBy: { id: "asc" },
    });
    expect(audits).toHaveLength(2);
    expect((audits[1]?.before as { userNote: string }).userNote).toBe("Ask Jose");
    const detail = await getTransactionDetail(db, t.id);
    expect(detail?.row.userNote).toBe("Jose says supplies");
    expect(detail?.row.systemNotes.some((n) => n.body.includes("statement line 12"))).toBe(true);
    expect(detail?.row.searchText).toContain("jose says supplies");
    expect(detail?.audit.map((a) => a.action)).toContain("transaction.create");
  });
});

describe("year-end close", () => {
  it("gates Mark closed on the checklist, files, and lets the Owner re-open with a reason", async () => {
    const yearRow = await owner.taxYear.upsert({
      where: { entityId_year: { entityId: TB.id, year: 2025 } },
      create: { entityId: TB.id, year: 2025, state: "OPEN" },
      update: {},
    });
    // A draft dated in the year keeps the automatic item open.
    const draft = await run((tx) =>
      createBankTransaction(tx, actor, {
        bankAccountId: bankB,
        date: "2025-03-03",
        vendor: "Pending",
        amountCents: -100n,
        accountId: EXPENSE,
        classId: clsB,
        post: false,
      }),
    );
    let check = await getChecklist(db, yearRow);
    expect(check.items.find((i) => i.key === "no_drafts")?.state).toBe("open");
    expect(check.canClose).toBe(false);
    await expect(run((tx) => closeTaxYear(tx, actor, yearRow.id))).rejects.toThrow(
      /checklist is not complete/,
    );
    await run((tx) => postTransaction(tx, actor, draft.id));
    check = await getChecklist(db, yearRow);
    expect(check.items.find((i) => i.key === "no_drafts")?.state).toBe("auto");
    expect(check.items.find((i) => i.key === "adjusting_entries")?.state).toBe("open");
    // Tick and override the rest.
    await run((tx) => setChecklistItem(tx, actor, yearRow.id, "bank_reconciled", { done: true }));
    await run((tx) =>
      setChecklistItem(tx, actor, yearRow.id, "model_applied", {
        done: false,
        overrideReason: "No shared costs this year",
      }),
    );
    await run((tx) =>
      setChecklistItem(tx, actor, yearRow.id, "adjusting_entries", {
        done: false,
        overrideReason: "Nothing to depreciate",
      }),
    );
    await run((tx) => setChecklistItem(tx, actor, yearRow.id, "export_generated", { done: true }));
    check = await getChecklist(db, yearRow);
    expect(check.canClose).toBe(true);
    expect(check.items.map((i) => i.state)).toEqual([
      "auto",
      "done",
      "overridden",
      "overridden",
      "done",
    ]);
    const closed = await run((tx) => closeTaxYear(tx, actor, yearRow.id, "Handed to TurboTax"));
    expect(closed.state).toBe("CLOSED");
    expect(closed.closedById).toBe(actor.userId);
    // Now the year is locked for ledger writes…
    await expect(run((tx) => voidTransaction(tx, actor, draft.id, "duplicate"))).rejects.toThrow(
      LockedYearError,
    );
    await expect(run((tx) => reopenTaxYear(tx, actor, yearRow.id, "no"))).rejects.toThrow(
      /five characters/,
    );
    const filed = await run((tx) => fileTaxYear(tx, actor, yearRow.id));
    expect(filed.state).toBe("FILED");
    const reopened = await run((tx) =>
      reopenTaxYear(tx, actor, yearRow.id, "Amended return needed"),
    );
    expect(reopened.state).toBe("OPEN");
    expect(reopened.overrideCount).toBe(1);
    const audits = await db.auditLog.findMany({
      where: { taxYearId: yearRow.id },
      orderBy: { id: "asc" },
      select: { action: true, isLockOverride: true },
    });
    expect(audits.map((a) => a.action)).toEqual([
      "tax_year.checklist_done",
      "tax_year.checklist_override",
      "tax_year.checklist_override",
      "tax_year.checklist_done",
      "tax_year.close",
      "tax_year.file",
      "tax_year.reopen",
    ]);
    expect(audits.at(-1)?.isLockOverride).toBe(true);
    // Re-closing runs the checklist again (still satisfied here).
    const again = await run((tx) => closeTaxYear(tx, actor, yearRow.id));
    expect(again.state).toBe("CLOSED");
    await run((tx) => reopenTaxYear(tx, actor, yearRow.id, "Keep it open for the remaining tests"));
  });
});

describe("saved views", () => {
  it("saves, lists and deletes a private view", async () => {
    const view = await run((tx) =>
      saveView(tx, actor, "ledger", "Fuel only", { globalFilter: "fuel" }),
    );
    const again = await run((tx) =>
      saveView(tx, actor, "ledger", "Fuel only", { globalFilter: "gas" }),
    );
    expect(again.id).toBe(view.id);
    const list = await listSavedViews(db, actor.userId, "ledger");
    expect(list.map((v) => v.name)).toEqual(["Fuel only"]);
    expect((list[0]?.state as { globalFilter: string }).globalFilter).toBe("gas");
    await run((tx) => deleteView(tx, actor, view.id));
    expect(await listSavedViews(db, actor.userId, "ledger")).toEqual([]);
  });
});
