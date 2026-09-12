"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { ForbiddenError, requestMeta, requirePermission } from "@/lib/auth/current-user";
import { hasFullAccess } from "@/lib/auth/permissions";
import {
  CLASS_KINDS,
  ClassError,
  createClass,
  setClassActive,
  updateClass,
} from "@/lib/org/classes";

export type ClassFormState = { ok?: boolean; error?: string };

const PAGE = "/settings/classes";

async function requireEditor() {
  const user = await requirePermission("VIEW_SETTINGS");
  if (!hasFullAccess(user.role))
    throw new ForbiddenError("Only Owner and Full-access users can change classes.");
  const meta = await requestMeta();
  return { userId: user.id, sessionId: user.sessionId, role: user.role, ...meta };
}

const text = (max: number) => z.string().trim().max(max).optional().default("");
const checkbox = z
  .string()
  .optional()
  .transform((v) => v === "on" || v === "true" || v === "1");

const classFields = {
  name: text(200),
  kind: z.enum(CLASS_KINDS).catch("RENTAL"),
  isLegalEntity: checkbox,
  legalEntityName: text(200),
  yearsNote: text(100),
  note: text(2000),
};

const createSchema = z.object({
  entityId: z.string().uuid("Choose which business this class belongs to."),
  ...classFields,
});
const updateSchema = z.object({
  id: z.string().uuid(),
  sortOrder: z
    .string()
    .trim()
    .optional()
    .default("")
    .transform((v) => (v === "" ? null : Number(v))),
  ...classFields,
});
const activeSchema = z.object({ id: z.string().uuid(), isActive: z.enum(["true", "false"]) });

function friendly(err: unknown): ClassFormState {
  if (err instanceof ClassError || err instanceof ForbiddenError) return { error: err.message };
  throw err;
}

export async function createClassAction(
  _prev: ClassFormState,
  formData: FormData,
): Promise<ClassFormState> {
  try {
    const actor = await requireEditor();
    const parsed = createSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success)
      return {
        error:
          parsed.error.issues[0]?.message ?? "Check the form — something is missing or too long.",
      };
    await db.$transaction(async (tx) => {
      await createClass(tx, actor, parsed.data);
    });
    revalidatePath(PAGE);
    return { ok: true };
  } catch (err) {
    return friendly(err);
  }
}

export async function updateClassAction(
  _prev: ClassFormState,
  formData: FormData,
): Promise<ClassFormState> {
  try {
    const actor = await requireEditor();
    const parsed = updateSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { error: "Check the form — something is missing or too long." };
    const { id, ...input } = parsed.data;
    await db.$transaction(async (tx) => {
      await updateClass(tx, actor, id, input);
    });
    revalidatePath(PAGE);
    return { ok: true };
  } catch (err) {
    return friendly(err);
  }
}

export async function setClassActiveAction(
  _prev: ClassFormState,
  formData: FormData,
): Promise<ClassFormState> {
  try {
    const actor = await requireEditor();
    const parsed = activeSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { error: "That class could not be found." };
    await db.$transaction(async (tx) => {
      await setClassActive(tx, actor, parsed.data.id, parsed.data.isActive === "true");
    });
    revalidatePath(PAGE);
    return { ok: true };
  } catch (err) {
    return friendly(err);
  }
}
