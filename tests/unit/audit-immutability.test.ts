import { afterAll, describe, expect, it } from "vitest";
import { createPrismaClient, db, disconnectDb } from "@/lib/db";

const owner = createPrismaClient(process.env.DATABASE_URL as string);

afterAll(async () => {
  await owner.$disconnect();
  await disconnectDb();
});

describe("audit_log is append-only", () => {
  it("lets the app role insert and read, but not update or delete (grants)", async () => {
    const row = await db.auditLog.create({ data: { action: "test.insert", subjectType: "test" } });
    expect(row.id).toBeDefined();
    await expect(
      db.auditLog.update({ where: { id: row.id }, data: { action: "tampered" } }),
    ).rejects.toThrow();
    await expect(db.auditLog.delete({ where: { id: row.id } })).rejects.toThrow();
    await expect(
      db.$executeRawUnsafe(`UPDATE audit_log SET action = 'x' WHERE id = ${row.id}`),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      db.$executeRawUnsafe(`DELETE FROM audit_log WHERE id = ${row.id}`),
    ).rejects.toThrow(/permission denied/i);
    const still = await db.auditLog.findUnique({ where: { id: row.id } });
    expect(still?.action).toBe("test.insert");
  });

  it("blocks even the database owner with a trigger", async () => {
    const row = await owner.auditLog.create({
      data: { action: "test.owner", subjectType: "test" },
    });
    await expect(
      owner.$executeRawUnsafe(`UPDATE audit_log SET action = 'x' WHERE id = ${row.id}`),
    ).rejects.toThrow(/append-only/i);
    await expect(
      owner.$executeRawUnsafe(`DELETE FROM audit_log WHERE id = ${row.id}`),
    ).rejects.toThrow(/append-only/i);
    await expect(owner.$executeRawUnsafe(`TRUNCATE audit_log`)).rejects.toThrow(/append-only/i);
  });

  it("keeps login attempts append-only for the app role too", async () => {
    const row = await db.loginAttempt.create({
      data: { email: "x@test.local", ip: "::1", succeeded: false },
    });
    await expect(db.loginAttempt.delete({ where: { id: row.id } })).rejects.toThrow();
  });
});

describe("other database-level rules", () => {
  it("allows exactly one active Owner", async () => {
    const owners = await owner.user.count({ where: { role: "OWNER", isActive: true } });
    const email = `second-owner-${Date.now()}@test.local`;
    if (owners === 0) {
      await owner.user.create({
        data: {
          email: `first-owner-${Date.now()}@test.local`,
          displayName: "O1",
          passwordHash: "x",
          role: "OWNER",
        },
      });
    }
    await expect(
      owner.user.create({ data: { email, displayName: "O2", passwordHash: "x", role: "OWNER" } }),
    ).rejects.toThrow();
  });

  it("never lets a tax year go backwards without an override reason in the same transaction", async () => {
    const entity = await owner.entity.upsert({
      where: { code: "TEST" },
      create: { code: "TEST", name: "Test entity", taxForm: "SCHEDULE_C" },
      update: {},
    });
    const year = await owner.taxYear.upsert({
      where: { entityId_year: { entityId: entity.id, year: 2001 } },
      create: { entityId: entity.id, year: 2001, state: "FILED" },
      update: { state: "FILED" },
    });
    await expect(
      owner.taxYear.update({ where: { id: year.id }, data: { state: "OPEN" } }),
    ).rejects.toThrow(/re-opened/i);
    await owner.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.lock_override_reason', 'test override', true)`;
      await tx.taxYear.update({ where: { id: year.id }, data: { state: "OPEN" } });
    });
    const after = await owner.taxYear.findUniqueOrThrow({ where: { id: year.id } });
    expect(after.state).toBe("OPEN");
  });

  it("refuses a bank account that points at a non-bank ledger account", async () => {
    const entity = await owner.entity.findFirstOrThrow();
    const expense = await owner.account.findFirst({ where: { type: "EXPENSE" } });
    if (!expense) return; // seed not run in this database
    await expect(
      owner.bankAccount.create({
        data: { entityId: entity.id, accountId: expense.id, name: "Bad", kind: "CHECKING" },
      }),
    ).rejects.toThrow(/sub_type Bank/i);
  });
});
