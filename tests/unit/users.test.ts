import { afterAll, describe, expect, it } from "vitest";
import { createPrismaClient, db, disconnectDb } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { changeOwner, createUser, removeUser, updateUser, UserError } from "@/lib/users";

const owner = createPrismaClient(process.env.DATABASE_URL as string);
const meta = { ip: null, userAgent: "vitest", sessionId: null };
const PASSWORD = "Temporary-Password-123";

afterAll(async () => {
  await owner.$disconnect();
  await disconnectDb();
});

async function ensureOwner() {
  const existing = await owner.user.findFirst({ where: { role: "OWNER", isActive: true } });
  if (existing) return existing;
  return owner.user.create({
    data: {
      email: `owner-${Date.now()}@test.local`,
      displayName: "Owner",
      passwordHash: await hashPassword(PASSWORD),
      role: "OWNER",
    },
  });
}

describe("user management rules", () => {
  it("lets Full access create Limited users but not Full users, and blocks self-edits", async () => {
    const jose = await ensureOwner();
    const full = await createUser(
      db,
      { userId: jose.id, role: "OWNER", ...meta },
      {
        email: `full-${Date.now()}@test.local`,
        displayName: "Full",
        password: PASSWORD,
        role: "FULL",
      },
    );
    const actor = { userId: full.id, role: "FULL" as const, ...meta };
    const limited = await createUser(db, actor, {
      email: `lim-${Date.now()}@test.local`,
      displayName: "Lim",
      password: PASSWORD,
      role: "LIMITED",
      permissions: ["VIEW_LEDGER", "UPLOAD_RECEIPTS", "bogus"],
    });
    const perms = await db.userPermission.findMany({ where: { userId: limited.id } });
    expect(perms.map((p) => p.permission).sort()).toEqual(["UPLOAD_RECEIPTS", "VIEW_LEDGER"]);
    await expect(
      createUser(db, actor, {
        email: `full2-${Date.now()}@test.local`,
        displayName: "F2",
        password: PASSWORD,
        role: "FULL",
      }),
    ).rejects.toThrow(UserError);
    await expect(updateUser(db, actor, full.id, { role: "LIMITED" })).rejects.toThrow(/own role/i);
    await expect(updateUser(db, actor, jose.id, { isActive: false })).rejects.toThrow(UserError);
    await expect(
      createUser(db, actor, {
        email: `weak-${Date.now()}@test.local`,
        displayName: "W",
        password: "short",
        role: "VIEW_ONLY",
      }),
    ).rejects.toThrow(/password/i);
  });

  it("stops a Limited user with Manage users from escalating", async () => {
    const jose = await ensureOwner();
    const lim = await createUser(
      db,
      { userId: jose.id, role: "OWNER", ...meta },
      {
        email: `limadmin-${Date.now()}@test.local`,
        displayName: "LimAdmin",
        password: PASSWORD,
        role: "LIMITED",
        permissions: ["MANAGE_USERS", "VIEW_LEDGER"],
      },
    );
    const actor = {
      userId: lim.id,
      role: "LIMITED" as const,
      permissions: ["MANAGE_USERS", "VIEW_LEDGER"],
      ...meta,
    };
    await expect(
      updateUser(db, actor, lim.id, {
        permissions: ["MANAGE_USERS", "VIEW_LEDGER", "EDIT_POSTED"],
      }),
    ).rejects.toThrow(/own role/i);
    await expect(
      createUser(db, actor, {
        email: `esc-${Date.now()}@test.local`,
        displayName: "E",
        password: PASSWORD,
        role: "FULL",
      }),
    ).rejects.toThrow(/lower access level/i);
    await expect(
      createUser(db, actor, {
        email: `esc2-${Date.now()}@test.local`,
        displayName: "E2",
        password: PASSWORD,
        role: "LIMITED",
        permissions: ["EDIT_POSTED"],
      }),
    ).rejects.toThrow(/do not have yourself/i);
    const viewer = await createUser(db, actor, {
      email: `viewer-${Date.now()}@test.local`,
      displayName: "V",
      password: PASSWORD,
      role: "VIEW_ONLY",
    });
    expect(viewer.role).toBe("VIEW_ONLY");
  });

  it("protects the Owner at the database level and transfers ownership atomically", async () => {
    const jose = await ensureOwner();
    await expect(
      owner.user.update({ where: { id: jose.id }, data: { isActive: false } }),
    ).rejects.toThrow(/Change owner/i);
    await expect(
      owner.user.update({ where: { id: jose.id }, data: { role: "FULL" } }),
    ).rejects.toThrow(/Change owner/i);
    const successor = await createUser(
      db,
      { userId: jose.id, role: "OWNER", ...meta },
      {
        email: `successor-${Date.now()}@test.local`,
        displayName: "Successor",
        password: PASSWORD,
        role: "FULL",
      },
    );
    await db.$transaction(async (tx) => {
      await changeOwner(
        tx,
        { userId: jose.id, role: "OWNER", ...meta },
        successor.id,
        "test transfer",
      );
    });
    expect((await db.user.findUniqueOrThrow({ where: { id: successor.id } })).role).toBe("OWNER");
    expect((await db.user.findUniqueOrThrow({ where: { id: jose.id } })).role).toBe("FULL");
    // and back again, so other tests keep their Owner
    await db.$transaction(async (tx) => {
      await changeOwner(
        tx,
        { userId: successor.id, role: "OWNER", ...meta },
        jose.id,
        "test transfer back",
      );
    });
    expect((await db.user.findUniqueOrThrow({ where: { id: jose.id } })).role).toBe("OWNER");
    await removeUser(db, { userId: jose.id, role: "OWNER", ...meta }, successor.id, "cleanup");
    const removed = await db.user.findUniqueOrThrow({ where: { id: successor.id } });
    expect(removed.isActive).toBe(false);
    expect(removed.passwordHash).toBe("!removed");
  });
});
