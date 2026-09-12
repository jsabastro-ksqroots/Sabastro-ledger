/**
 * Roles and permissions. Values mirror the Prisma enums `UserRole` and `Permission` exactly so the
 * generated client's string enums can be passed straight in.
 */
export const ROLES = ["OWNER", "FULL", "LIMITED", "VIEW_ONLY"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  "VIEW_LEDGER",
  "UPLOAD_RECEIPTS",
  "REVIEW_CONFIRM",
  "EDIT_POSTED",
  "MANAGE_MODELS",
  "RUN_REPORTS",
  "EXPORT",
  "VIEW_SETTINGS",
  "MANAGE_USERS",
  "CLOSE_YEAR",
] as const;
export type PermissionKey = (typeof PERMISSIONS)[number];

export const PERMISSION_LABELS: Record<PermissionKey, string> = {
  VIEW_LEDGER: "View the ledger",
  UPLOAD_RECEIPTS: "Upload receipts",
  REVIEW_CONFIRM: "Review and confirm transactions",
  EDIT_POSTED: "Edit posted transactions",
  MANAGE_MODELS: "Manage allocation models",
  RUN_REPORTS: "Run reports",
  EXPORT: "Export data",
  VIEW_SETTINGS: "View settings",
  MANAGE_USERS: "Manage users",
  CLOSE_YEAR: "Close and file tax years",
};

export const ROLE_LABELS: Record<Role, string> = {
  OWNER: "Owner",
  FULL: "Full access",
  LIMITED: "Limited",
  VIEW_ONLY: "View only",
};

/** Things only the Owner may do, over and above every permission (see docs/DECISIONS.md P0-12). */
export const OWNER_ONLY = [
  "REMOVE_USERS",
  "CHANGE_OWNER",
  "REOPEN_YEAR",
  "REAPPLY_MODEL_FILED_YEAR",
] as const;
export type OwnerAbility = (typeof OWNER_ONLY)[number];

const ALL = new Set<PermissionKey>(PERMISSIONS);
const VIEW_ONLY_SET = new Set<PermissionKey>(["VIEW_LEDGER", "RUN_REPORTS"]);

/** The permissions a user actually has, given their role and (for Limited users) the granted checklist. */
export function effectivePermissions(
  role: Role,
  granted: Iterable<PermissionKey> = [],
): Set<PermissionKey> {
  switch (role) {
    case "OWNER":
    case "FULL":
      return new Set(ALL);
    case "VIEW_ONLY":
      return new Set(VIEW_ONLY_SET);
    case "LIMITED":
      return new Set([...granted].filter((p) => ALL.has(p)));
  }
}

export function hasPermission(
  role: Role,
  granted: Iterable<PermissionKey>,
  permission: PermissionKey,
): boolean {
  return effectivePermissions(role, granted).has(permission);
}

export function hasOwnerAbility(role: Role, _ability: OwnerAbility): boolean {
  return role === "OWNER";
}

export class ForbiddenError extends Error {
  constructor(message = "You do not have permission to do that.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/** Pure, testable guard used by the request-scoped helpers. */
export function assertPermission(
  user: { role: Role; permissions: Iterable<PermissionKey> },
  permission: PermissionKey,
): void {
  if (!hasPermission(user.role, user.permissions, permission)) throw new ForbiddenError();
}

export function assertOwner(user: { role: Role }, ability: OwnerAbility): void {
  if (!hasOwnerAbility(user.role, ability)) throw new ForbiddenError("Only the Owner can do that.");
}

/** Access levels, highest first. Used to stop anyone managing users at or above their own level. */
export const ROLE_RANK: Record<Role, number> = { OWNER: 3, FULL: 2, LIMITED: 1, VIEW_ONLY: 0 };

/** Owner and Full access may edit the building blocks of the books (entities, bank accounts, chart, classes). */
export function hasFullAccess(role: Role): boolean {
  return role === "OWNER" || role === "FULL";
}
