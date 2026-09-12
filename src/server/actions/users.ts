"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  ForbiddenError,
  requestMeta,
  requirePermission,
  requireUser,
  UnauthenticatedError,
  type CurrentUser,
} from "@/lib/auth/current-user";
import { regenerateRecoveryCodes, resetMfa } from "@/lib/auth/mfa";
import { PERMISSIONS, ROLES, type Role } from "@/lib/auth/permissions";
import {
  changeOwner,
  changeOwnPassword,
  createUser,
  removeUser,
  setTemporaryPassword,
  unlockUser,
  updateUser,
  userAbilities,
  UserError,
  type UserAbilities,
} from "@/lib/users";

export type ActionState = { ok?: boolean; error?: string };
export type RecoveryCodesState = { codes?: string[]; error?: string };

const PAGE = "/settings/users";

const uuid = z.uuid();
const password = z.string().min(1, "Enter a password.").max(500);
const reason = z
  .string()
  .trim()
  .min(3, "Please give a short reason (at least 3 characters).")
  .max(500);
const roleSchema = z.enum(ROLES);

/** Turns validation and permission problems into a message for the form; anything else keeps bubbling. */
function toActionError(e: unknown): ActionState {
  if (e instanceof UserError || e instanceof ForbiddenError || e instanceof UnauthenticatedError)
    return { error: e.message };
  throw e;
}

function firstIssue(result: { error: z.ZodError }): string {
  return result.error.issues[0]?.message ?? "Please check the form and try again.";
}

async function actorFor(user: CurrentUser) {
  const meta = await requestMeta();
  return {
    userId: user.id,
    sessionId: user.sessionId,
    role: user.role as Role,
    permissions: user.permissions,
    ...meta,
  };
}

function abilitiesFor(
  user: CurrentUser,
  target: Parameters<typeof userAbilities>[1],
): UserAbilities {
  return userAbilities(
    { id: user.id, role: user.role as Role, permissions: user.permissions },
    target,
  );
}

async function loadTarget(userId: string) {
  return db.user.findUnique({ where: { id: userId } });
}

const MISSING = { error: "That user no longer exists. Refresh the page." } as const;

// ----------------------------------------------------------------------------- my account

const ownPasswordSchema = z.object({ password, confirm: password });

export async function changeOwnPasswordAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requireUser();
    const parsed = ownPasswordSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { error: firstIssue(parsed) };
    if (parsed.data.password !== parsed.data.confirm)
      return { error: "The two passwords do not match." };
    const actor = await actorFor(user);
    await db.$transaction(async (tx) => {
      await changeOwnPassword(tx, actor, parsed.data.password);
    });
    revalidatePath(PAGE);
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function regenerateRecoveryCodesAction(
  _prev: RecoveryCodesState,
  _formData: FormData,
): Promise<RecoveryCodesState> {
  try {
    const user = await requireUser();
    const actor = await actorFor(user);
    const codes = await db.$transaction(async (tx) =>
      regenerateRecoveryCodes(tx, {
        userId: actor.userId,
        sessionId: actor.sessionId,
        ip: actor.ip,
        userAgent: actor.userAgent,
      }),
    );
    revalidatePath(PAGE);
    return { codes };
  } catch (e) {
    return toActionError(e);
  }
}

// ----------------------------------------------------------------------------- managing others

const createSchema = z.object({
  email: z.string().trim().min(3, "Enter an email address.").max(200),
  displayName: z.string().trim().min(1, "Enter a name.").max(100),
  password,
  role: roleSchema,
});

export async function createUserAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requirePermission("MANAGE_USERS");
    const parsed = createSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { error: firstIssue(parsed) };
    const permissions = formData
      .getAll("permissions")
      .map(String)
      .filter((p) => (PERMISSIONS as readonly string[]).includes(p));
    const actor = await actorFor(user);
    await db.$transaction(async (tx) => {
      await createUser(tx, actor, { ...parsed.data, permissions });
    });
    revalidatePath(PAGE);
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

const updateSchema = z.object({
  userId: uuid,
  displayName: z.string().trim().min(1, "Enter a name.").max(100),
  role: roleSchema,
  isActive: z.string().optional(),
  wasActive: z.string().optional(),
});

export async function updateUserAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requirePermission("MANAGE_USERS");
    const parsed = updateSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { error: firstIssue(parsed) };
    const target = await loadTarget(parsed.data.userId);
    if (!target) return MISSING;
    if (!abilitiesFor(user, target).canEdit) throw new ForbiddenError("You cannot edit this user.");
    const permissions = formData
      .getAll("permissions")
      .map(String)
      .filter((p) => (PERMISSIONS as readonly string[]).includes(p));
    const isActive = parsed.data.isActive === "on";
    const wasActive = parsed.data.wasActive === "on";
    const actor = await actorFor(user);
    await db.$transaction(async (tx) => {
      await updateUser(tx, actor, target.id, {
        displayName: parsed.data.displayName,
        role: parsed.data.role,
        permissions,
        ...(isActive !== wasActive ? { isActive } : {}),
      });
    });
    revalidatePath(PAGE);
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

const tempPasswordSchema = z.object({ userId: uuid, password, confirm: password });

export async function setTemporaryPasswordAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requirePermission("MANAGE_USERS");
    const parsed = tempPasswordSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { error: firstIssue(parsed) };
    if (parsed.data.password !== parsed.data.confirm)
      return { error: "The two passwords do not match." };
    const target = await loadTarget(parsed.data.userId);
    if (!target) return MISSING;
    if (!abilitiesFor(user, target).canSetPassword)
      throw new ForbiddenError("You cannot set a password for this user.");
    const actor = await actorFor(user);
    await db.$transaction(async (tx) => {
      await setTemporaryPassword(tx, actor, target.id, parsed.data.password);
    });
    revalidatePath(PAGE);
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

const resetMfaSchema = z.object({ userId: uuid, reason });

export async function resetMfaAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requirePermission("MANAGE_USERS");
    const parsed = resetMfaSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { error: firstIssue(parsed) };
    const target = await loadTarget(parsed.data.userId);
    if (!target) return MISSING;
    if (!abilitiesFor(user, target).canResetMfa)
      throw new ForbiddenError("You cannot reset this user's authenticator.");
    const actor = await actorFor(user);
    await db.$transaction(async (tx) => {
      await resetMfa(
        tx,
        {
          userId: actor.userId,
          sessionId: actor.sessionId,
          role: actor.role,
          ip: actor.ip,
          userAgent: actor.userAgent,
        },
        target.id,
        parsed.data.reason,
      );
    });
    revalidatePath(PAGE);
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

const userIdSchema = z.object({ userId: uuid });

export async function unlockUserAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requirePermission("MANAGE_USERS");
    const parsed = userIdSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { error: firstIssue(parsed) };
    const target = await loadTarget(parsed.data.userId);
    if (!target) return MISSING;
    if (!abilitiesFor(user, target).canUnlock)
      throw new ForbiddenError("This account is not locked, or you cannot unlock it.");
    const actor = await actorFor(user);
    await db.$transaction(async (tx) => {
      await unlockUser(tx, actor, target.id);
    });
    revalidatePath(PAGE);
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

const removeSchema = z.object({ userId: uuid, reason });

export async function removeUserAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requirePermission("MANAGE_USERS");
    const parsed = removeSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { error: firstIssue(parsed) };
    const target = await loadTarget(parsed.data.userId);
    if (!target) return MISSING;
    if (!abilitiesFor(user, target).canRemove)
      throw new ForbiddenError("Only the Owner can remove users.");
    const actor = await actorFor(user);
    await db.$transaction(async (tx) => {
      await removeUser(tx, actor, target.id, parsed.data.reason);
    });
    revalidatePath(PAGE);
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

const changeOwnerSchema = z.object({
  userId: uuid,
  reason,
  confirmEmail: z.string().trim().max(200),
});

export async function changeOwnerAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requirePermission("MANAGE_USERS");
    const parsed = changeOwnerSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { error: firstIssue(parsed) };
    const target = await loadTarget(parsed.data.userId);
    if (!target) return MISSING;
    if (!abilitiesFor(user, target).canMakeOwner)
      throw new ForbiddenError("Only the Owner can hand over ownership.");
    if (parsed.data.confirmEmail.toLowerCase() !== target.email.toLowerCase()) {
      return { error: `To confirm, type the new owner's email exactly: ${target.email}` };
    }
    const actor = await actorFor(user);
    await db.$transaction(async (tx) => {
      await changeOwner(tx, actor, target.id, parsed.data.reason);
    });
    revalidatePath(PAGE);
    revalidatePath("/", "layout"); // the role shown in the top bar changes for both people
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}
