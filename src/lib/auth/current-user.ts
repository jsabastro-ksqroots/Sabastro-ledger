import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import {
  resolveSession,
  SESSION_COOKIE,
  sessionCookieOptions,
  type RequestMeta,
  type ResolvedSession,
} from "@/lib/auth/session";
import {
  assertOwner,
  assertPermission,
  ForbiddenError,
  hasOwnerAbility,
  hasPermission,
  type OwnerAbility,
  type PermissionKey,
  type Role,
} from "@/lib/auth/permissions";

export { ForbiddenError };
import { env } from "@/lib/env";

export class UnauthenticatedError extends Error {
  constructor(message = "Please sign in.") {
    super(message);
    this.name = "UnauthenticatedError";
  }
}

/**
 * IP and user-agent of the current request, for the audit log and the per-IP throttle.
 * The client IP is taken from X-Forwarded-For only when TRUST_PROXY_HEADERS=true (behind Caddy, which
 * appends the real client address as the LAST entry). Otherwise the header is untrusted and the IP is
 * recorded as unknown, so a client cannot spoof or evade the throttle.
 */
export async function requestMeta(): Promise<RequestMeta> {
  const h = await headers();
  let ip: string | null = null;
  if (process.env.TRUST_PROXY_HEADERS === "true") {
    const xff = h.get("x-forwarded-for");
    if (xff) {
      const parts = xff
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      ip = parts[parts.length - 1] ?? null;
    } else {
      ip = h.get("x-real-ip");
    }
  }
  return { ip: ip ? ip.slice(0, 64) : null, userAgent: h.get("user-agent") };
}

/** Resolves the session cookie once per request. */
export const getCurrentSession = cache(async (): Promise<ResolvedSession | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  return resolveSession(db, token);
});

export async function setSessionCookie(token: string): Promise<void> {
  const jar = await cookies();
  const opts = sessionCookieOptions(env().APP_URL);
  jar.set(opts.name, token, {
    httpOnly: opts.httpOnly,
    secure: opts.secure,
    sameSite: opts.sameSite,
    path: opts.path,
    maxAge: opts.maxAge,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  const opts = sessionCookieOptions(env().APP_URL);
  jar.set(opts.name, "", {
    httpOnly: opts.httpOnly,
    secure: opts.secure,
    sameSite: opts.sameSite,
    path: opts.path,
    maxAge: 0,
  });
}

export type CurrentUser = ResolvedSession["user"] & { sessionId: string };

export function toCurrentUser(resolved: ResolvedSession): CurrentUser {
  return { ...resolved.user, sessionId: resolved.session.id };
}

export function userCan(
  user: { role: Role; permissions: string[] },
  permission: PermissionKey,
): boolean {
  return hasPermission(user.role, user.permissions as PermissionKey[], permission);
}

export function userIsOwner(user: { role: Role }, ability: OwnerAbility = "CHANGE_OWNER"): boolean {
  return hasOwnerAbility(user.role, ability);
}

/**
 * For pages inside the app shell: a fully signed-in (password + MFA) user, or a redirect to the right step.
 */
export async function requireFullSession(nextPath?: string): Promise<CurrentUser> {
  const resolved = await getCurrentSession();
  if (!resolved) redirect(nextPath ? `/login?next=${encodeURIComponent(nextPath)}` : "/login");
  if (!resolved.session.mfaVerifiedAt) {
    redirect(resolved.user.mfaEnrolledAt ? "/mfa/verify" : "/mfa/enroll");
  }
  return toCurrentUser(resolved);
}

/** For the MFA pages: a half-open session (password ok, MFA pending) or a fully open one. */
export async function requireHalfSession(): Promise<CurrentUser> {
  const resolved = await getCurrentSession();
  if (!resolved) redirect("/login");
  return toCurrentUser(resolved);
}

/** For server actions and route handlers: throws instead of redirecting. */
export async function requireUser(): Promise<CurrentUser> {
  const resolved = await getCurrentSession();
  if (!resolved || !resolved.session.mfaVerifiedAt) throw new UnauthenticatedError();
  return toCurrentUser(resolved);
}

export async function requirePermission(permission: PermissionKey): Promise<CurrentUser> {
  const user = await requireUser();
  assertPermission(
    { role: user.role, permissions: user.permissions as PermissionKey[] },
    permission,
  );
  return user;
}

export async function requireOwner(ability: OwnerAbility): Promise<CurrentUser> {
  const user = await requireUser();
  assertOwner(user, ability);
  return user;
}
