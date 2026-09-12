import type { DbOrTx } from "@/lib/db";
import { audit } from "@/lib/audit";
import type { RequestMeta } from "@/lib/auth/session";
import type { Role } from "@/lib/auth/permissions";

/**
 * Classes: every transaction line carries one. Most are properties; 544 Liberty and 176 Tulsk are
 * legal entities tracked as classes under SREI. "General" is the one shared class and can never be
 * deactivated. A class's entity cannot be changed here — promoting a class to its own entity is a
 * migration (insert an entity, re-point entity_id, keep every line), see CLAUDE.md.
 */

export type Actor = { userId: string; sessionId: string | null; role?: Role } & RequestMeta;

export class ClassError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClassError";
  }
}

export const CLASS_KINDS = ["GENERAL", "RENTAL", "LAND", "FLIP", "BUSINESS"] as const;
export type ClassKindKey = (typeof CLASS_KINDS)[number];

export const CLASS_KIND_LABELS: Record<ClassKindKey, string> = {
  GENERAL: "General",
  RENTAL: "Rental property",
  LAND: "Land development",
  FLIP: "Flip",
  BUSINESS: "Business line",
};

/** The naming convention the books already use; suggested in the form, not enforced. */
export const CLASS_NAME_PREFIXES = ["Rentals:", "Land Development:", "Flips:"] as const;

export interface ClassCreateInput {
  name: string;
  entityId: string;
  kind: ClassKindKey;
  isLegalEntity?: boolean;
  legalEntityName?: string | null;
  yearsNote?: string | null;
  note?: string | null;
}

export interface ClassUpdateInput {
  name: string;
  kind: ClassKindKey;
  isLegalEntity?: boolean;
  legalEntityName?: string | null;
  yearsNote?: string | null;
  note?: string | null;
  sortOrder?: number | null;
}

function clean(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function optional(value: string | null | undefined): string | null {
  const v = clean(value);
  return v.length ? v : null;
}

function validateName(name: string): string {
  const n = clean(name).replace(/\s+/g, " ");
  if (!n) throw new ClassError("Give the class a name.");
  if (n.length > 120) throw new ClassError("The class name is too long (120 characters at most).");
  return n;
}

function validateFields(input: Omit<ClassUpdateInput, "name" | "sortOrder">) {
  if (!CLASS_KINDS.includes(input.kind)) throw new ClassError("Choose what kind of class this is.");
  const isLegalEntity = !!input.isLegalEntity;
  const legalEntityName = isLegalEntity ? optional(input.legalEntityName) : null;
  if (isLegalEntity && !legalEntityName)
    throw new ClassError("Enter the legal entity's name (for example “544 Liberty LLC”).");
  const yearsNote = optional(input.yearsNote);
  if (yearsNote && yearsNote.length > 60)
    throw new ClassError("Keep the years note short (for example “2021-2025”).");
  const note = optional(input.note);
  if (note && note.length > 1000)
    throw new ClassError("The note is too long (1,000 characters at most).");
  return { kind: input.kind, isLegalEntity, legalEntityName, yearsNote, note };
}

async function assertNameFree(tx: DbOrTx, name: string, exceptId?: string) {
  const clash = await tx.class.findFirst({
    where: {
      name: { equals: name, mode: "insensitive" },
      ...(exceptId ? { NOT: { id: exceptId } } : {}),
    },
  });
  if (clash)
    throw new ClassError(
      `A class named “${clash.name}” already exists${clash.isActive ? "" : " (it is inactive — reactivate it instead)"}.`,
    );
}

export async function listClasses(tx: DbOrTx, opts: { includeInactive?: boolean } = {}) {
  return tx.class.findMany({
    where: opts.includeInactive ? {} : { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: { entity: { select: { id: true, code: true, name: true } } },
  });
}

export type ClassRow = Awaited<ReturnType<typeof listClasses>>[number];

export async function createClass(tx: DbOrTx, actor: Actor, input: ClassCreateInput) {
  const name = validateName(input.name);
  const fields = validateFields(input);
  const entity = await tx.entity.findUnique({ where: { id: input.entityId } });
  if (!entity) throw new ClassError("Choose which business this class belongs to.");
  if (!entity.isActive)
    throw new ClassError(
      `${entity.code} is inactive; a new class must belong to an active business.`,
    );
  await assertNameFree(tx, name);
  const last = await tx.class.aggregate({ _max: { sortOrder: true } });
  const cls = await tx.class.create({
    data: {
      name,
      entityId: entity.id,
      isShared: false,
      sortOrder: (last._max.sortOrder ?? 0) + 1,
      ...fields,
    },
  });
  await audit(tx, {
    action: "class.create",
    userId: actor.userId,
    sessionId: actor.sessionId,
    subjectType: "class",
    subjectId: cls.id,
    subjectLabel: cls.name,
    entityId: entity.id,
    after: snapshot(cls),
    ip: actor.ip,
    userAgent: actor.userAgent,
  });
  return cls;
}

export async function updateClass(tx: DbOrTx, actor: Actor, id: string, input: ClassUpdateInput) {
  const before = await tx.class.findUnique({ where: { id } });
  if (!before) throw new ClassError("That class no longer exists.");
  const name = validateName(input.name);
  if (before.isShared && name !== before.name)
    throw new ClassError(
      "“General” is the shared class every business uses; it cannot be renamed.",
    );
  const fields = validateFields(input);
  if (name !== before.name) await assertNameFree(tx, name, id);
  const sortOrder =
    input.sortOrder === null || input.sortOrder === undefined ? before.sortOrder : input.sortOrder;
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 9999)
    throw new ClassError("Sort order must be a whole number between 0 and 9999.");
  const after = await tx.class.update({ where: { id }, data: { name, sortOrder, ...fields } });
  await audit(tx, {
    action: "class.update",
    userId: actor.userId,
    sessionId: actor.sessionId,
    subjectType: "class",
    subjectId: id,
    subjectLabel: before.name,
    entityId: before.entityId,
    before: snapshot(before),
    after: snapshot(after),
    ip: actor.ip,
    userAgent: actor.userAgent,
  });
  return after;
}

export async function setClassActive(tx: DbOrTx, actor: Actor, id: string, isActive: boolean) {
  const before = await tx.class.findUnique({ where: { id } });
  if (!before) throw new ClassError("That class no longer exists.");
  if (before.isActive === isActive) return before;
  if (!isActive && (before.isShared || before.name === "General")) {
    throw new ClassError(
      "“General” can never be deactivated — it is the shared class that every business falls back to.",
    );
  }
  const after = await tx.class.update({ where: { id }, data: { isActive } });
  await audit(tx, {
    action: isActive ? "class.reactivate" : "class.deactivate",
    userId: actor.userId,
    sessionId: actor.sessionId,
    subjectType: "class",
    subjectId: id,
    subjectLabel: before.name,
    entityId: before.entityId,
    before: { isActive: before.isActive },
    after: { isActive: after.isActive },
    ip: actor.ip,
    userAgent: actor.userAgent,
  });
  return after;
}

function snapshot(c: {
  name: string;
  entityId: string;
  kind: string;
  isShared: boolean;
  isLegalEntity: boolean;
  legalEntityName: string | null;
  yearsNote: string | null;
  note: string | null;
  sortOrder: number;
  isActive: boolean;
}) {
  return {
    name: c.name,
    entityId: c.entityId,
    kind: c.kind,
    isShared: c.isShared,
    isLegalEntity: c.isLegalEntity,
    legalEntityName: c.legalEntityName,
    yearsNote: c.yearsNote,
    note: c.note,
    sortOrder: c.sortOrder,
    isActive: c.isActive,
  };
}
