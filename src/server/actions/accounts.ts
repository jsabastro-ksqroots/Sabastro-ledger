"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { ForbiddenError, requestMeta, requirePermission } from "@/lib/auth/current-user";
import { hasFullAccess } from "@/lib/auth/permissions";
import {
  ACCOUNT_TYPES,
  AccountError,
  createAccount,
  setAccountActive,
  updateAccount,
} from "@/lib/org/accounts";

export type AccountFormState = { ok?: boolean; error?: string };

const PAGE = "/settings/accounts";

/** Anyone who can see Settings may look; only Owner and Full access may change the chart. */
async function requireEditor() {
  const user = await requirePermission("VIEW_SETTINGS");
  if (!hasFullAccess(user.role))
    throw new ForbiddenError("Only Owner and Full-access users can change the chart of accounts.");
  const meta = await requestMeta();
  return { userId: user.id, sessionId: user.sessionId, role: user.role, ...meta };
}

const text = (max: number) => z.string().trim().max(max).optional().default("");

const accountFields = {
  name: text(200),
  parentGroup: text(200),
  type: z.enum(ACCOUNT_TYPES).catch("EXPENSE"),
  subType: text(120),
  subType2: text(120),
  note: text(2000),
};

const createSchema = z.object({ number: text(10), ...accountFields });
const updateSchema = z.object({ id: z.string().uuid(), ...accountFields });
const activeSchema = z.object({ id: z.string().uuid(), isActive: z.enum(["true", "false"]) });

function friendly(err: unknown): AccountFormState {
  if (err instanceof AccountError || err instanceof ForbiddenError) return { error: err.message };
  throw err;
}

export async function createAccountAction(
  _prev: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  try {
    const actor = await requireEditor();
    const parsed = createSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { error: "Check the form — something is missing or too long." };
    await db.$transaction(async (tx) => {
      await createAccount(tx, actor, parsed.data);
    });
    revalidatePath(PAGE);
    return { ok: true };
  } catch (err) {
    return friendly(err);
  }
}

export async function updateAccountAction(
  _prev: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  try {
    const actor = await requireEditor();
    const parsed = updateSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { error: "Check the form — something is missing or too long." };
    const { id, ...input } = parsed.data;
    await db.$transaction(async (tx) => {
      await updateAccount(tx, actor, id, input);
    });
    revalidatePath(PAGE);
    return { ok: true };
  } catch (err) {
    return friendly(err);
  }
}

export async function setAccountActiveAction(
  _prev: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  try {
    const actor = await requireEditor();
    const parsed = activeSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { error: "That account could not be found." };
    await db.$transaction(async (tx) => {
      await setAccountActive(tx, actor, parsed.data.id, parsed.data.isActive === "true");
    });
    revalidatePath(PAGE);
    return { ok: true };
  } catch (err) {
    return friendly(err);
  }
}
