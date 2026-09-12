import { afterAll, describe, expect, it } from "vitest";
import { createPrismaClient } from "@/lib/db";
import { runSeed } from "@/lib/seed/run-seed";
import { loadSeedAccounts, loadSeedClasses } from "@/lib/seed/seed-data";

const owner = createPrismaClient(process.env.DATABASE_URL as string);

afterAll(async () => {
  await owner.$disconnect();
});

const users = [
  {
    email: "seed-owner@test.local",
    displayName: "Seed Owner",
    password: "Seed-Owner-Password-1",
    role: "OWNER" as const,
  },
  {
    email: "seed-full@test.local",
    displayName: "Seed Full",
    password: "Seed-Full-Password-1",
    role: "FULL" as const,
  },
];

describe("seed", () => {
  it("loads the seed CSVs completely", () => {
    const accounts = loadSeedAccounts();
    expect(accounts).toHaveLength(76);
    expect(accounts.find((a) => a.number === "1104")?.name).toBe("Venmo");
    expect(accounts.filter((a) => a.type === "EXPENSE").length).toBeGreaterThan(20);
    const classes = loadSeedClasses();
    expect(classes).toHaveLength(13);
    expect(classes.find((c) => c.name === "General")?.isShared).toBe(true);
    expect(classes.find((c) => c.name === "Providence")?.entityCode).toBe("PLA");
    expect(classes.find((c) => c.name === "Rentals:176 Tulsk Road")?.legalEntityName).toBe(
      "176 Tulsk LLC",
    );
    expect(classes.find((c) => c.name === "Flips:1 Mystery Rose")?.isActive).toBe(false);
    expect(classes.find((c) => c.name === "Rentals:533 Mystic Lane")?.isActive).toBe(false);
  });

  it("is idempotent and never overwrites edits", async () => {
    const existingOwner = await owner.user.findFirst({ where: { role: "OWNER", isActive: true } });
    // If another test already created an Owner, seed a Full user only (one active Owner allowed).
    const seedUsers = existingOwner ? users.filter((u) => u.role !== "OWNER") : users;

    const first = await runSeed(owner, { users: seedUsers, appDbPassword: null });
    const second = await runSeed(owner, { users: seedUsers, appDbPassword: null });

    expect(second.entities.created).toBe(0);
    expect(second.accounts.created).toBe(0);
    expect(second.bankAccounts.created).toBe(0);
    expect(second.classes.created).toBe(0);
    expect(second.taxYears.created).toBe(0);
    expect(second.bridgeRules.created).toBe(0);
    expect(second.settings.created).toBe(0);
    expect(second.users.created).toBe(0);
    expect(first.accounts.created + first.accounts.existing).toBe(76);
    expect(second.accounts.existing).toBe(76);
    expect(second.classes.existing).toBe(13);
    expect(second.entities.existing).toBeGreaterThanOrEqual(2);
    expect(second.bankAccounts.existing).toBe(4);
    expect(second.taxYears.existing).toBeGreaterThanOrEqual(8);

    // A renamed account survives a re-seed.
    await owner.account.update({
      where: { number: "5215" },
      data: { name: "Supplies (renamed in test)" },
    });
    await runSeed(owner, { users: seedUsers, appDbPassword: null });
    const renamed = await owner.account.findUniqueOrThrow({ where: { number: "5215" } });
    expect(renamed.name).toBe("Supplies (renamed in test)");
    await owner.account.update({ where: { number: "5215" }, data: { name: "Supplies Expense" } });

    // Seeded users keep their password hash across runs.
    const full = await owner.user.findUniqueOrThrow({ where: { email: "seed-full@test.local" } });
    await owner.user.update({ where: { id: full.id }, data: { displayName: "Edited Name" } });
    await runSeed(owner, { users: seedUsers, appDbPassword: null });
    expect((await owner.user.findUniqueOrThrow({ where: { id: full.id } })).displayName).toBe(
      "Edited Name",
    );

    // The seed writes an audit row each time it runs.
    const seedRuns = await owner.auditLog.count({ where: { action: "seed.run" } });
    expect(seedRuns).toBeGreaterThanOrEqual(4);
  });

  it("seeds the expected structure", async () => {
    const srei = await owner.entity.findUniqueOrThrow({ where: { code: "SREI" } });
    const pla = await owner.entity.findUniqueOrThrow({ where: { code: "PLA" } });
    expect(await owner.bankAccount.count({ where: { entityId: srei.id } })).toBe(3);
    expect(await owner.bankAccount.count({ where: { entityId: pla.id } })).toBe(1);
    const years = await owner.taxYear.findMany({
      where: { entityId: srei.id },
      orderBy: { year: "asc" },
    });
    expect(years.map((y) => `${y.year}:${y.state}`)).toEqual([
      "2019:FILED",
      "2020:FILED",
      "2021:FILED",
      "2022:FILED",
      "2023:FILED",
      "2024:FILED",
      "2025:OPEN",
    ]);
    const plaYears = await owner.taxYear.findMany({ where: { entityId: pla.id } });
    expect(plaYears.map((y) => `${y.year}:${y.state}`)).toEqual(["2025:OPEN"]);
    const rules = await owner.entityBridgeRule.findMany({
      include: { payerAccount: true, receiverAccount: true },
    });
    expect(rules).toHaveLength(2);
    expect(
      rules.every((r) => r.payerAccount.number === "3102" && r.receiverAccount.number === "3101"),
    ).toBe(true);
  });
});
