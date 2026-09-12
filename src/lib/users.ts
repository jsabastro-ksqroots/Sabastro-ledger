import type { DbOrTx } from "@/lib/db";
import { audit } from "@/lib/audit";
import { hashPassword, passwordProblems } from "@/lib/auth/password";
import { normalizeEmail } from "@/lib/auth/login";
import { revokeAllSessions, type RequestMeta } from "@/lib/auth/session";
import {
  effectivePermissions,
  PERMISSIONS,
  ROLE_RANK,
  type PermissionKey,
  type Role,
} from "@/lib/auth/permissions";

type Actor = {
  userId: string;
  sessionId: string | null;
  role: Role;
  permissions?: string[];
} & RequestMeta;

export class UserError extends Error {}

/**
 * Who may manage whom (docs/DECISIONS.md P0-20):
 *  - nobody edits their own role, permissions or active flag through the admin path;
 *  - you may only manage users below your own level; a Limited user with "Manage users" may also
 *    manage other Limited users but can only hand out permissions they hold themselves;
 *  - only the Owner may create or edit Full-access users; the Owner is only touched via "Change owner".
 */
function assertCanManage(
  actor: Actor,
  targetRole: Role,
  newRole: Role,
  newPermissions: PermissionKey[],
): void {
  if (actor.role === "OWNER") {
    if (targetRole === "OWNER" || newRole === "OWNER")
      throw new UserError("Use “Change owner” to move ownership.");
    return;
  }
  const mine = ROLE_RANK[actor.role];
  const okTarget =
    ROLE_RANK[targetRole] < mine || (actor.role === "LIMITED" && targetRole === "LIMITED");
  const okNew = ROLE_RANK[newRole] < mine || (actor.role === "LIMITED" && newRole === "LIMITED");
  if (!okTarget || !okNew)
    throw new UserError("You can only manage users with a lower access level than your own.");
  if (actor.role === "LIMITED") {
    const held = effectivePermissions(actor.role, (actor.permissions ?? []) as PermissionKey[]);
    const extra = newPermissions.filter((p) => !held.has(p));
    if (extra.length) throw new UserError("You cannot grant permissions you do not have yourself.");
  }
}

function cleanPermissions(role: Role, permissions: string[] | undefined): PermissionKey[] {
  if (role !== "LIMITED") return [];
  const valid = new Set<string>(PERMISSIONS);
  return [...new Set((permissions ?? []).filter((p) => valid.has(p)))] as PermissionKey[];
}

export async function listUsers(tx: DbOrTx) {
  return tx.user.findMany({
    orderBy: [{ isActive: "desc" }, { role: "asc" }, { displayName: "asc" }],
    include: {
      permissions: true,
      _count: { select: { sessions: { where: { revokedAt: null } } } },
    },
  });
}

export async function createUser(
  tx: DbOrTx,
  actor: Actor,
  input: {
    email: string;
    displayName: string;
    password: string;
    role: Role;
    permissions?: string[];
  },
) {
  const email = normalizeEmail(input.email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    throw new UserError("That email address does not look right.");
  const problems = passwordProblems(input.password);
  if (problems.length) throw new UserError(`The temporary password needs ${problems.join(", ")}.`);
  if (input.role === "OWNER")
    throw new UserError("There can only be one Owner. Use “Change owner” instead.");
  const permissions = cleanPermissions(input.role, input.permissions);
  assertCanManage(actor, "VIEW_ONLY", input.role, permissions);
  const existing = await tx.user.findUnique({ where: { email } });
  if (existing) throw new UserError("A user with that email already exists.");
  const user = await tx.user.create({
    data: {
      email,
      displayName: input.displayName.trim(),
      passwordHash: await hashPassword(input.password),
      role: input.role,
      permissions: { create: permissions.map((permission) => ({ permission })) },
    },
  });
  await audit(tx, {
    action: "user.create",
    userId: actor.userId,
    sessionId: actor.sessionId,
    subjectType: "user",
    subjectId: user.id,
    subjectLabel: email,
    after: { email, displayName: user.displayName, role: user.role, permissions },
    ip: actor.ip,
    userAgent: actor.userAgent,
  });
  return user;
}

export async function updateUser(
  tx: DbOrTx,
  actor: Actor,
  userId: string,
  input: { displayName?: string; role?: Role; permissions?: string[]; isActive?: boolean },
) {
  const before = await tx.user.findUniqueOrThrow({
    where: { id: userId },
    include: { permissions: true },
  });
  if (
    before.id === actor.userId &&
    (input.role !== undefined || input.permissions !== undefined || input.isActive !== undefined)
  ) {
    throw new UserError(
      "You cannot change your own role, permissions or active status. Ask another administrator.",
    );
  }
  if (before.role === "OWNER")
    throw new UserError("The Owner's account can only be changed through “Change owner”.");
  if (input.role === "OWNER") throw new UserError("Use “Change owner” to transfer ownership.");
  const role = input.role ?? before.role;
  const permissions =
    input.permissions !== undefined || input.role !== undefined
      ? cleanPermissions(role, input.permissions ?? before.permissions.map((p) => p.permission))
      : before.permissions.map((p) => p.permission as PermissionKey);
  if (input.role !== undefined || input.permissions !== undefined || input.isActive !== undefined) {
    assertCanManage(actor, before.role, role, permissions);
  } else if (
    actor.role !== "OWNER" &&
    ROLE_RANK[before.role] >= ROLE_RANK[actor.role] &&
    !(actor.role === "LIMITED" && before.role === "LIMITED")
  ) {
    throw new UserError("You can only manage users with a lower access level than your own.");
  }
  const after = await tx.user.update({
    where: { id: userId },
    data: {
      displayName: input.displayName?.trim() ?? before.displayName,
      role,
      isActive: input.isActive ?? before.isActive,
      permissions: { deleteMany: {}, create: permissions.map((permission) => ({ permission })) },
    },
    include: { permissions: true },
  });
  if (input.isActive === false) {
    await revokeAllSessions(tx, userId, "account deactivated", actor);
  }
  await audit(tx, {
    action:
      input.isActive === false
        ? "user.deactivate"
        : input.isActive === true && !before.isActive
          ? "user.reactivate"
          : "user.update",
    userId: actor.userId,
    sessionId: actor.sessionId,
    subjectType: "user",
    subjectId: userId,
    subjectLabel: before.email,
    before: {
      displayName: before.displayName,
      role: before.role,
      isActive: before.isActive,
      permissions: before.permissions.map((p) => p.permission),
    },
    after: {
      displayName: after.displayName,
      role: after.role,
      isActive: after.isActive,
      permissions: after.permissions.map((p) => p.permission),
    },
    ip: actor.ip,
    userAgent: actor.userAgent,
  });
  return after;
}

/** Owner only: transfers the Owner role to another active user; the previous owner becomes Full access. */
export async function changeOwner(tx: DbOrTx, actor: Actor, newOwnerId: string, reason: string) {
  if (actor.role !== "OWNER") throw new UserError("Only the Owner can transfer ownership.");
  const target = await tx.user.findUniqueOrThrow({ where: { id: newOwnerId } });
  if (!target.isActive) throw new UserError("The new owner must be an active user.");
  if (target.id === actor.userId) throw new UserError("You are already the Owner.");
  // The partial unique index allows exactly one active OWNER, so demote first; the users_protect_owner
  // trigger only lets that happen inside a transaction flagged as an ownership transfer.
  await tx.$executeRaw`SELECT set_config('app.owner_transfer', 'yes', true)`;
  await tx.user.update({ where: { id: actor.userId }, data: { role: "FULL" } });
  await tx.user.update({
    where: { id: target.id },
    data: { role: "OWNER", permissions: { deleteMany: {} } },
  });
  await audit(tx, {
    action: "user.change_owner",
    userId: actor.userId,
    sessionId: actor.sessionId,
    subjectType: "user",
    subjectId: target.id,
    subjectLabel: target.email,
    before: { owner: actor.userId },
    after: { owner: target.id },
    reason,
    ip: actor.ip,
    userAgent: actor.userAgent,
  });
}

/** Owner only: permanently removes a user's access (kept as an inactive row so the audit trail stays intact). */
export async function removeUser(tx: DbOrTx, actor: Actor, userId: string, reason: string) {
  if (actor.role !== "OWNER") throw new UserError("Only the Owner can remove users.");
  if (userId === actor.userId) throw new UserError("You cannot remove yourself.");
  const target = await tx.user.findUniqueOrThrow({ where: { id: userId } });
  if (target.role === "OWNER") throw new UserError("The Owner cannot be removed.");
  await tx.user.update({
    where: { id: userId },
    data: {
      isActive: false,
      mfaSecretEnc: null,
      mfaEnrolledAt: null,
      mfaLastTimeStep: null,
      passwordHash: "!removed",
      permissions: { deleteMany: {} },
      recoveryCodes: { deleteMany: {} },
    },
  });
  await revokeAllSessions(tx, userId, "user removed", actor);
  await audit(tx, {
    action: "user.remove",
    userId: actor.userId,
    sessionId: actor.sessionId,
    subjectType: "user",
    subjectId: userId,
    subjectLabel: target.email,
    reason,
    ip: actor.ip,
    userAgent: actor.userAgent,
  });
}

export async function changeOwnPassword(tx: DbOrTx, actor: Actor, newPassword: string) {
  const problems = passwordProblems(newPassword);
  if (problems.length) throw new UserError(`The new password needs ${problems.join(", ")}.`);
  await tx.user.update({
    where: { id: actor.userId },
    data: { passwordHash: await hashPassword(newPassword) },
  });
  await revokeAllSessions(tx, actor.userId, "password changed", actor, {
    keepSessionId: actor.sessionId,
  });
  await audit(tx, {
    action: "user.password_change",
    userId: actor.userId,
    sessionId: actor.sessionId,
    subjectType: "user",
    subjectId: actor.userId,
    ip: actor.ip,
    userAgent: actor.userAgent,
  });
}

/** Admin sets a temporary password for someone else; all their sessions end. */
export async function setTemporaryPassword(
  tx: DbOrTx,
  actor: Actor,
  userId: string,
  newPassword: string,
) {
  const problems = passwordProblems(newPassword);
  if (problems.length) throw new UserError(`The temporary password needs ${problems.join(", ")}.`);
  const target = await tx.user.findUniqueOrThrow({ where: { id: userId } });
  if (target.id === actor.userId)
    throw new UserError("Use “Change my password” for your own account.");
  if (
    actor.role !== "OWNER" &&
    ROLE_RANK[target.role] >= ROLE_RANK[actor.role] &&
    !(actor.role === "LIMITED" && target.role === "LIMITED")
  ) {
    throw new UserError(
      "You can only reset passwords for users with a lower access level than your own.",
    );
  }
  await tx.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(newPassword), failedLoginCount: 0, lockedUntil: null },
  });
  await revokeAllSessions(tx, userId, "password reset by administrator", actor);
  await audit(tx, {
    action: "user.password_reset",
    userId: actor.userId,
    sessionId: actor.sessionId,
    subjectType: "user",
    subjectId: userId,
    subjectLabel: target.email,
    ip: actor.ip,
    userAgent: actor.userAgent,
  });
}

export async function unlockUser(tx: DbOrTx, actor: Actor, userId: string) {
  const target = await tx.user.findUniqueOrThrow({ where: { id: userId } });
  await tx.user.update({ where: { id: userId }, data: { failedLoginCount: 0, lockedUntil: null } });
  await audit(tx, {
    action: "user.unlock",
    userId: actor.userId,
    sessionId: actor.sessionId,
    subjectType: "user",
    subjectId: userId,
    subjectLabel: target.email,
    ip: actor.ip,
    userAgent: actor.userAgent,
  });
}

// ---------------------------------------------------------------------------------------------
// Pure helpers for the Settings → Users screen. They answer "what may this actor do to that user"
// without touching the database, so the page can hide buttons and the actions can refuse requests
// using the same rule (docs/DESIGN.md §6, docs/DECISIONS.md P0-20).
// ---------------------------------------------------------------------------------------------

export type UserActor = { id: string; role: Role; permissions?: string[] };
export type ManagedUser = {
  id: string;
  role: Role;
  isActive: boolean;
  lockedUntil?: Date | null;
  mfaEnrolledAt?: Date | null;
  passwordHash?: string;
};

export type UserAbilities = {
  canEdit: boolean;
  canSetPassword: boolean;
  canResetMfa: boolean;
  canUnlock: boolean;
  canRemove: boolean;
  canMakeOwner: boolean;
};

const REMOVED_PASSWORD_HASH = "!removed";

/** A removed user is kept as an inactive row (for the audit trail) with a password that can never match. */
export function isRemovedUser(user: { passwordHash?: string | null }): boolean {
  return user.passwordHash === REMOVED_PASSWORD_HASH;
}

export function actorHasManageUsers(actor: UserActor): boolean {
  return effectivePermissions(actor.role, (actor.permissions ?? []) as PermissionKey[]).has(
    "MANAGE_USERS",
  );
}

/** The ladder: may `actor` manage `target` at all (edit, set password, reset MFA, unlock)? */
export function canManageUser(actor: UserActor, target: { id: string; role: Role }): boolean {
  if (!actorHasManageUsers(actor)) return false;
  if (target.id === actor.id) return false; // your own account changes through "My account" only
  if (target.role === "OWNER") return false; // the Owner is only touched through "Change owner"
  if (actor.role === "OWNER") return true;
  return (
    ROLE_RANK[target.role] < ROLE_RANK[actor.role] ||
    (actor.role === "LIMITED" && target.role === "LIMITED")
  );
}

/** Roles this actor may hand out when creating or editing a user. */
export function assignableRoles(actor: UserActor): Role[] {
  if (!actorHasManageUsers(actor)) return [];
  switch (actor.role) {
    case "OWNER":
      return ["FULL", "LIMITED", "VIEW_ONLY"];
    case "FULL":
      return ["LIMITED", "VIEW_ONLY"];
    case "LIMITED":
      return ["LIMITED", "VIEW_ONLY"];
    default:
      return [];
  }
}

/** Permissions this actor may tick for a Limited user (a Limited administrator can only pass on what they hold). */
export function grantablePermissions(actor: UserActor): PermissionKey[] {
  if (!actorHasManageUsers(actor)) return [];
  const held = effectivePermissions(actor.role, (actor.permissions ?? []) as PermissionKey[]);
  return PERMISSIONS.filter((p) => held.has(p));
}

export function userAbilities(
  actor: UserActor,
  target: ManagedUser,
  now = new Date(),
): UserAbilities {
  const removed = isRemovedUser(target);
  const manage = canManageUser(actor, target) && !removed;
  const ownerActor = actor.role === "OWNER" && actorHasManageUsers(actor);
  const locked = !!target.lockedUntil && target.lockedUntil.getTime() > now.getTime();
  return {
    canEdit: manage,
    canSetPassword: manage && target.isActive,
    canResetMfa: manage && !!target.mfaEnrolledAt,
    canUnlock: manage && locked,
    canRemove: ownerActor && target.id !== actor.id && target.role !== "OWNER" && !removed,
    canMakeOwner:
      ownerActor &&
      target.id !== actor.id &&
      target.role !== "OWNER" &&
      target.isActive &&
      !removed,
  };
}
