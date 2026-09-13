import { describe, expect, it } from "vitest";
import { resolveLineEntity } from "@/lib/ledger/attribution";
import { balancesPerEntity, computeBridgeLines, entityNets } from "@/lib/ledger/bridge";
import { deriveBankLines, simpleRowToPrimaryLine } from "@/lib/ledger/simple-row";

const SREI = "srei";
const PLA = "pla";
const GENERAL = "cls-general";
const PROVIDENCE = "cls-providence";
const SHED = "cls-shed";
const BANK_1101 = "acct-1101";
const BANK_1103 = "acct-1103";
const A3102 = "acct-3102";
const A3101 = "acct-3101";

const ctx = {
  homeEntityId: SREI,
  bankEntityByAccountId: new Map([
    [BANK_1101, SREI],
    [BANK_1103, PLA],
  ]),
  classes: new Map([
    [GENERAL, { entityId: SREI, isShared: true }],
    [PROVIDENCE, { entityId: PLA, isShared: false }],
    [SHED, { entityId: SREI, isShared: false }],
  ]),
};

const bridgeOpts = {
  rules: [
    { payerEntityId: SREI, receiverEntityId: PLA, payerAccountId: A3102, receiverAccountId: A3101 },
    { payerEntityId: PLA, receiverEntityId: SREI, payerAccountId: A3102, receiverAccountId: A3101 },
  ],
  generalClassId: GENERAL,
  defaultPayerAccountId: A3102,
  defaultReceiverAccountId: A3101,
  entityCodes: new Map([
    [SREI, "SREI"],
    [PLA, "PLA"],
  ]),
};

const line = (entityId: string, classId: string | null, debit: bigint, credit: bigint) => ({
  entityId,
  classId,
  debitCents: debit,
  creditCents: credit,
  isBridge: false,
});

describe("entity attribution", () => {
  it("gives a bank line to the bank's entity whatever its class", () => {
    expect(resolveLineEntity({ accountId: BANK_1101, classId: PROVIDENCE }, ctx)).toBe(SREI);
    expect(resolveLineEntity({ accountId: BANK_1103, classId: GENERAL }, ctx)).toBe(PLA);
  });
  it("gives any other line to its class's entity, and General to the home entity", () => {
    expect(resolveLineEntity({ accountId: "acct-5215", classId: PROVIDENCE }, ctx)).toBe(PLA);
    expect(resolveLineEntity({ accountId: "acct-5215", classId: SHED }, ctx)).toBe(SREI);
    expect(resolveLineEntity({ accountId: "acct-5215", classId: GENERAL }, ctx)).toBe(SREI);
    expect(resolveLineEntity({ accountId: null, classId: null }, ctx)).toBe(SREI);
  });
});

describe("simple row → lines", () => {
  it("money out is Dr account / Cr bank; money in is Dr bank / Cr account", () => {
    const out = simpleRowToPrimaryLine({
      amountCents: -13515n,
      accountId: "acct-5215",
      classId: SHED,
    });
    expect(out).toMatchObject({ debitCents: 13515n, creditCents: 0n });
    const bankOut = deriveBankLines([out], BANK_1101);
    expect(bankOut).toEqual([
      { accountId: BANK_1101, classId: SHED, debitCents: 0n, creditCents: 13515n },
    ]);

    const inn = simpleRowToPrimaryLine({
      amountCents: 90000n,
      accountId: "acct-4101",
      classId: SHED,
    });
    expect(inn).toMatchObject({ debitCents: 0n, creditCents: 90000n });
    expect(deriveBankLines([inn], BANK_1101)).toEqual([
      { accountId: BANK_1101, classId: SHED, debitCents: 90000n, creditCents: 0n },
    ]);
  });
  it("derives one bank line per class for a split", () => {
    const bank = deriveBankLines(
      [
        { classId: SHED, debitCents: 6000n, creditCents: 0n },
        { classId: PROVIDENCE, debitCents: 4000n, creditCents: 0n },
        { classId: SHED, debitCents: 500n, creditCents: 0n },
      ],
      BANK_1101,
    );
    expect(bank).toEqual([
      { accountId: BANK_1101, classId: SHED, debitCents: 0n, creditCents: 6500n },
      { accountId: BANK_1101, classId: PROVIDENCE, debitCents: 0n, creditCents: 4000n },
    ]);
  });
  it("rejects a zero amount", () => {
    expect(() =>
      simpleRowToPrimaryLine({ amountCents: 0n, accountId: "a", classId: SHED }),
    ).toThrow(/cannot be zero/);
  });
});

describe("cross-entity bridge", () => {
  it("adds nothing when every entity already balances", () => {
    const lines = [line(SREI, SHED, 100n, 0n), line(SREI, SHED, 0n, 100n)];
    expect(computeBridgeLines(lines, bridgeOpts)).toEqual([]);
  });

  it("money out: SREI bank pays a Providence expense → SREI Dr 3102 General, PLA Cr 3101 Providence", () => {
    const lines = [line(PLA, PROVIDENCE, 10000n, 0n), line(SREI, PROVIDENCE, 0n, 10000n)];
    const bridge = computeBridgeLines(lines, bridgeOpts);
    expect(bridge).toEqual([
      expect.objectContaining({
        entityId: SREI,
        accountId: A3102,
        classId: GENERAL,
        debitCents: 10000n,
        creditCents: 0n,
      }),
      expect.objectContaining({
        entityId: PLA,
        accountId: A3101,
        classId: PROVIDENCE,
        debitCents: 0n,
        creditCents: 10000n,
      }),
    ]);
    expect(bridge[0]?.memo).toBe("Cross-entity bridge: SREI paid for PLA");
    expect(balancesPerEntity([...lines, ...bridge])).toBe(true);
  });

  it("money in: a PLA client pays into the SREI bank → PLA is the payer, SREI the receiver", () => {
    const lines = [line(SREI, PROVIDENCE, 50000n, 0n), line(PLA, PROVIDENCE, 0n, 50000n)];
    const bridge = computeBridgeLines(lines, bridgeOpts);
    expect(bridge).toEqual([
      expect.objectContaining({
        entityId: PLA,
        accountId: A3102,
        classId: GENERAL,
        debitCents: 50000n,
      }),
      expect.objectContaining({
        entityId: SREI,
        accountId: A3101,
        classId: PROVIDENCE,
        creditCents: 50000n,
      }),
    ]);
    expect(balancesPerEntity([...lines, ...bridge])).toBe(true);
  });

  it("bridges only the foreign share of a split, per receiving class", () => {
    const lines = [
      line(SREI, SHED, 6000n, 0n),
      line(PLA, PROVIDENCE, 4000n, 0n),
      line(SREI, SHED, 0n, 6000n),
      line(SREI, PROVIDENCE, 0n, 4000n),
    ];
    const bridge = computeBridgeLines(lines, bridgeOpts);
    expect(bridge).toHaveLength(2);
    expect(bridge.find((b) => b.entityId === SREI)?.debitCents).toBe(4000n);
    expect(bridge.find((b) => b.entityId === PLA)).toMatchObject({
      classId: PROVIDENCE,
      creditCents: 4000n,
    });
    expect(balancesPerEntity([...lines, ...bridge])).toBe(true);
  });

  it("uses the rule's accounts for the pair, falling back to the defaults", () => {
    const opts = {
      ...bridgeOpts,
      rules: [
        {
          payerEntityId: SREI,
          receiverEntityId: PLA,
          payerAccountId: "due-from-pla",
          receiverAccountId: "due-to-srei",
        },
      ],
    };
    const lines = [line(PLA, PROVIDENCE, 100n, 0n), line(SREI, PROVIDENCE, 0n, 100n)];
    const bridge = computeBridgeLines(lines, opts);
    expect(bridge.map((b) => b.accountId)).toEqual(["due-from-pla", "due-to-srei"]);
    const reverse = computeBridgeLines(
      [line(SREI, PROVIDENCE, 100n, 0n), line(PLA, PROVIDENCE, 0n, 100n)],
      opts,
    );
    expect(reverse.map((b) => b.accountId)).toEqual([A3102, A3101]);
  });

  it("ignores existing bridge lines when computing nets", () => {
    const nets = entityNets([
      line(PLA, PROVIDENCE, 100n, 0n),
      line(SREI, PROVIDENCE, 0n, 100n),
      { ...line(SREI, GENERAL, 100n, 0n), isBridge: true },
    ]);
    expect(nets.get(SREI)?.total).toBe(-100n);
    expect(nets.get(PLA)?.total).toBe(100n);
  });
});
