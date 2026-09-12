import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient, db, disconnectDb } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import {
  ClassError,
  createClass,
  listClasses,
  setClassActive,
  updateClass,
} from "@/lib/org/classes";

const owner = createPrismaClient(process.env.DATABASE_URL as string);
const meta = { ip: null, userAgent: "vitest", sessionId: null };

let actor: { userId: string; sessionId: string | null; role: "FULL"; ip: null; userAgent: string };
let entityId: string;

beforeAll(async () => {
  const user = await owner.user.create({
    data: {
      email: `class-actor-${Date.now()}@test.local`,
      displayName: "Class Actor",
      passwordHash: await hashPassword("Temporary-Password-123"),
      role: "FULL",
    },
  });
  actor = { userId: user.id, role: "FULL", ...meta };
  const srei = await owner.entity.findUnique({ where: { code: "SREI" } });
  entityId = srei
    ? srei.id
    : (
        await owner.entity.create({
          data: {
            code: "SREI",
            name: "Sabastro Real Estate Investments",
            legalName: "Sabastro Real Estate Investments LLC",
            taxForm: "FORM_1065",
          },
        })
      ).id;
});

afterAll(async () => {
  await owner.$disconnect();
  await disconnectDb();
});

async function ensureGeneral() {
  const existing = await owner.class.findUnique({ where: { name: "General" } });
  if (existing) return existing;
  return owner.class.create({
    data: { name: "General", entityId, isShared: true, kind: "GENERAL", sortOrder: 0 },
  });
}

describe("classes", () => {
  it("creates a class with a trimmed unique name, appends it to the sort order, and audits it", async () => {
    const name = `Rentals:${Date.now()} Test Lane`;
    const cls = await db.$transaction((tx) =>
      createClass(tx, actor, {
        name: `  ${name}  `,
        entityId,
        kind: "RENTAL",
        yearsNote: "2026",
        note: "",
      }),
    );
    expect(cls.name).toBe(name);
    expect(cls.isShared).toBe(false);
    expect(cls.isLegalEntity).toBe(false);
    expect(cls.legalEntityName).toBeNull();
    expect(cls.note).toBeNull();
    const all = await listClasses(db);
    expect(all[all.length - 1]?.id).toBe(cls.id);
    const rows = await db.auditLog.findMany({ where: { subjectType: "class", subjectId: cls.id } });
    expect(rows.map((r) => r.action)).toEqual(["class.create"]);
    expect(rows[0]?.subjectLabel).toBe(name);
    expect(rows[0]?.entityId).toBe(entityId);
  });

  it("rejects duplicate names (case-insensitively), blank names, and legal entities without a name", async () => {
    const name = `Flips:${Date.now()} Dup`;
    await createClass(db, actor, { name, entityId, kind: "FLIP" });
    await expect(
      createClass(db, actor, { name: name.toUpperCase(), entityId, kind: "FLIP" }),
    ).rejects.toThrow(/already exists/);
    await expect(createClass(db, actor, { name: "   ", entityId, kind: "FLIP" })).rejects.toThrow(
      /name/i,
    );
    await expect(
      createClass(db, actor, {
        name: `LLC ${Date.now()}`,
        entityId,
        kind: "RENTAL",
        isLegalEntity: true,
        legalEntityName: "",
      }),
    ).rejects.toThrow(/legal entity/i);
    await expect(
      createClass(db, actor, {
        name: `Nowhere ${Date.now()}`,
        entityId: "00000000-0000-0000-0000-000000000000",
        kind: "RENTAL",
      }),
    ).rejects.toThrow(ClassError);
  });

  it("updates a class (name, kind, legal entity, sort order) with before/after in the audit log", async () => {
    const name = `Land Development:${Date.now()} Acre`;
    const cls = await createClass(db, actor, { name, entityId, kind: "LAND" });
    const updated = await db.$transaction((tx) =>
      updateClass(tx, actor, cls.id, {
        name: `${name} Renamed`,
        kind: "RENTAL",
        isLegalEntity: true,
        legalEntityName: "Acre LLC",
        yearsNote: "2026-",
        note: "now rented",
        sortOrder: 42,
      }),
    );
    expect(updated.name).toBe(`${name} Renamed`);
    expect(updated.kind).toBe("RENTAL");
    expect(updated.legalEntityName).toBe("Acre LLC");
    expect(updated.sortOrder).toBe(42);
    expect(updated.entityId).toBe(entityId); // entity is never changed here
    const row = await db.auditLog.findFirst({
      where: { subjectType: "class", subjectId: cls.id, action: "class.update" },
    });
    expect((row?.before as { name: string }).name).toBe(name);
    expect((row?.after as { legalEntityName: string }).legalEntityName).toBe("Acre LLC");
    // Unticking "legal entity" clears the legal name.
    const cleared = await updateClass(db, actor, cls.id, {
      name: updated.name,
      kind: "RENTAL",
      isLegalEntity: false,
      legalEntityName: "stale",
    });
    expect(cleared.legalEntityName).toBeNull();
    await expect(
      updateClass(db, actor, cls.id, { name: updated.name, kind: "RENTAL", sortOrder: -1 }),
    ).rejects.toThrow(/Sort order/);
  });

  it("deactivates and reactivates, hiding inactive classes from the default list", async () => {
    const cls = await createClass(db, actor, {
      name: `Rentals:${Date.now()} Off`,
      entityId,
      kind: "RENTAL",
    });
    await db.$transaction((tx) => setClassActive(tx, actor, cls.id, false));
    expect((await listClasses(db)).map((c) => c.id)).not.toContain(cls.id);
    expect((await listClasses(db, { includeInactive: true })).map((c) => c.id)).toContain(cls.id);
    await setClassActive(db, actor, cls.id, true);
    const actions = (
      await db.auditLog.findMany({
        where: { subjectType: "class", subjectId: cls.id },
        orderBy: { id: "asc" },
      })
    ).map((r) => r.action);
    expect(actions).toEqual(["class.create", "class.deactivate", "class.reactivate"]);
  });

  it("never deactivates or renames General", async () => {
    const general = await ensureGeneral();
    await expect(setClassActive(db, actor, general.id, false)).rejects.toThrow(/General/);
    expect((await db.class.findUniqueOrThrow({ where: { id: general.id } })).isActive).toBe(true);
    await expect(
      updateClass(db, actor, general.id, { name: "Everything", kind: "GENERAL" }),
    ).rejects.toThrow(/cannot be renamed/);
    // Editing its note is fine.
    const noted = await updateClass(db, actor, general.id, {
      name: "General",
      kind: "GENERAL",
      note: general.note ?? "",
    });
    expect(noted.name).toBe("General");
  });
});
