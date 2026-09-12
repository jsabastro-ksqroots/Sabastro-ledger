"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  ForbiddenError,
  requestMeta,
  requirePermission,
  UnauthenticatedError,
  type CurrentUser,
} from "@/lib/auth/current-user";
import { hasFullAccess } from "@/lib/auth/permissions";
import {
  BANK_KINDS,
  BRIDGE_MODES,
  createBankAccount,
  createEntity,
  EntityError,
  TAX_FORMS,
  updateBankAccount,
  updateEntity,
  upsertBridgeRule,
  type Actor,
} from "@/lib/org/entities";

export type EntityActionState = { ok?: boolean; error?: string };

const PAGE = "/settings/entities";

/** Viewing settings is one permission; changing the building blocks of the books needs Owner or Full access. */
async function requireEditor(): Promise<{ user: CurrentUser; actor: Actor }> {
  const user = await requirePermission("VIEW_SETTINGS");
  if (!hasFullAccess(user.role))
    throw new ForbiddenError(
      "Only the Owner and Full-access users can change entities and bank accounts.",
    );
  const meta = await requestMeta();
  return { user, actor: { userId: user.id, sessionId: user.sessionId, ...meta } };
}

/** Runs one write; validation and permission problems come back as a message, anything else is a real error. */
async function run(work: () => Promise<void>): Promise<EntityActionState> {
  try {
    await work();
    revalidatePath(PAGE);
    return { ok: true };
  } catch (err) {
    if (
      err instanceof EntityError ||
      err instanceof ForbiddenError ||
      err instanceof UnauthenticatedError
    )
      return { error: err.message };
    throw err;
  }
}

const optionalText = z
  .string()
  .trim()
  .max(500)
  .optional()
  .transform((v) => (v ? v : null));
const uuid = z.string().uuid();

const entitySchema = z.object({
  code: z.string().trim().max(20).optional(),
  name: z.string().trim().max(200),
  legalName: optionalText,
  taxForm: z.enum(TAX_FORMS),
  isActive: z.string().optional(),
});

export async function createEntityAction(
  _prev: EntityActionState,
  formData: FormData,
): Promise<EntityActionState> {
  const parsed = entitySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Fill in the short code, the name and the tax form." };
  return run(async () => {
    const { actor } = await requireEditor();
    await db.$transaction(async (tx) => {
      await createEntity(tx, actor, {
        code: parsed.data.code ?? "",
        name: parsed.data.name,
        legalName: parsed.data.legalName,
        taxForm: parsed.data.taxForm,
      });
    });
  });
}

export async function updateEntityAction(
  _prev: EntityActionState,
  formData: FormData,
): Promise<EntityActionState> {
  const parsed = entitySchema.extend({ id: uuid }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Fill in the name and the tax form." };
  return run(async () => {
    const { actor } = await requireEditor();
    await db.$transaction(async (tx) => {
      await updateEntity(tx, actor, parsed.data.id, {
        name: parsed.data.name,
        legalName: parsed.data.legalName,
        taxForm: parsed.data.taxForm,
        isActive: parsed.data.isActive === "on",
      });
    });
  });
}

const bankFieldsSchema = z.object({
  name: z.string().trim().max(200),
  institution: optionalText,
  kind: z.enum(BANK_KINDS),
  last4: optionalText,
  openedOn: optionalText,
  closedOn: optionalText,
});

const createBankSchema = bankFieldsSchema.extend({
  entityId: uuid,
  linkMode: z.enum(["existing", "new"]),
  accountId: z.string().optional(),
  newNumber: z.string().trim().max(20).optional(),
  newName: z.string().trim().max(200).optional(),
});

export async function createBankAccountAction(
  _prev: EntityActionState,
  formData: FormData,
): Promise<EntityActionState> {
  const parsed = createBankSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Fill in the bank account name and the kind of account." };
  const d = parsed.data;
  return run(async () => {
    const { actor } = await requireEditor();
    await db.$transaction(async (tx) => {
      await createBankAccount(tx, actor, {
        entityId: d.entityId,
        accountId: d.linkMode === "existing" ? d.accountId || null : null,
        newAccount:
          d.linkMode === "new" ? { number: d.newNumber ?? "", name: d.newName ?? "" } : null,
        name: d.name,
        institution: d.institution,
        kind: d.kind,
        last4: d.last4,
        openedOn: d.openedOn,
        closedOn: d.closedOn,
      });
    });
  });
}

export async function updateBankAccountAction(
  _prev: EntityActionState,
  formData: FormData,
): Promise<EntityActionState> {
  const parsed = bankFieldsSchema.extend({ id: uuid }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Fill in the bank account name and the kind of account." };
  const d = parsed.data;
  return run(async () => {
    const { actor } = await requireEditor();
    await db.$transaction(async (tx) => {
      await updateBankAccount(tx, actor, d.id, {
        name: d.name,
        institution: d.institution,
        kind: d.kind,
        last4: d.last4,
        openedOn: d.openedOn,
        closedOn: d.closedOn,
      });
    });
  });
}

const activeSchema = z.object({ id: uuid, isActive: z.enum(["true", "false"]) });

export async function setBankAccountActiveAction(
  _prev: EntityActionState,
  formData: FormData,
): Promise<EntityActionState> {
  const parsed = activeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success)
    return { error: "Something went wrong — please reload the page and try again." };
  return run(async () => {
    const { actor } = await requireEditor();
    await db.$transaction(async (tx) => {
      await updateBankAccount(tx, actor, parsed.data.id, {
        isActive: parsed.data.isActive === "true",
      });
    });
  });
}

const bridgeSchema = z.object({
  payerEntityId: uuid,
  receiverEntityId: uuid,
  mode: z.enum(BRIDGE_MODES),
  payerAccountId: z.string().optional(),
  receiverAccountId: z.string().optional(),
});

export async function upsertBridgeRuleAction(
  _prev: EntityActionState,
  formData: FormData,
): Promise<EntityActionState> {
  const parsed = bridgeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Pick the mode and both accounts." };
  const d = parsed.data;
  return run(async () => {
    const { actor } = await requireEditor();
    await db.$transaction(async (tx) => {
      await upsertBridgeRule(tx, actor, {
        payerEntityId: d.payerEntityId,
        receiverEntityId: d.receiverEntityId,
        mode: d.mode,
        payerAccountId: d.payerAccountId ?? "",
        receiverAccountId: d.receiverAccountId ?? "",
      });
    });
  });
}
