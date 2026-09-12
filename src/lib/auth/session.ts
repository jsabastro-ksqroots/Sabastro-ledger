import { randomToken, sha256Hex } from "@/lib/crypto";
import type { DbOrTx } from "@/lib/db";
import { audit } from "@/lib/audit";
import { SESSION_COOKIE_NAME } from "@/lib/auth/constants";

export const SESSION_COOKIE = SESSION_COOKIE_NAME;
export const SESSION_IDLE_MS = 12 * 60 * 60 * 1000; // 12 hours without activity
export const SESSION_ABSOLUTE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days, no matter what
export const HALF_OPEN_TTL_MS = 10 * 60 * 1000; // password ok, MFA pending: 10 minutes to finish
const TOUCH_INTERVAL_MS = 60 * 1000; // write last_seen_at at most once a minute

export interface RequestMeta {
  ip?: string | null;
  userAgent?: string | null;
}

export async function createSession(
  tx: DbOrTx,
  userId: string,
  meta: RequestMeta,
  opts: { mfaVerified: boolean },
): Promise<{ token: string; sessionId: string }> {
  const token = randomToken(32);
  const now = new Date();
  const session = await tx.session.create({
    data: {
      tokenHash: sha256Hex(token),
      userId,
      mfaVerifiedAt: opts.mfaVerified ? now : null,
      expiresAt: new Date(
        now.getTime() + (opts.mfaVerified ? SESSION_ABSOLUTE_MS : HALF_OPEN_TTL_MS),
      ),
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ? meta.userAgent.slice(0, 500) : null,
    },
  });
  return { token, sessionId: session.id };
}

export type ResolvedSession = {
  session: {
    id: string;
    userId: string;
    mfaVerifiedAt: Date | null;
    createdAt: Date;
    lastSeenAt: Date;
    expiresAt: Date;
  };
  user: {
    id: string;
    email: string;
    displayName: string;
    role: "OWNER" | "FULL" | "LIMITED" | "VIEW_ONLY";
    isActive: boolean;
    mfaEnrolledAt: Date | null;
    permissions: string[];
  };
};

/** Looks up a session by its raw cookie token. Returns null when missing, expired, idle-expired, or revoked. */
export async function resolveSession(
  tx: DbOrTx,
  token: string | undefined | null,
  now = new Date(),
): Promise<ResolvedSession | null> {
  if (!token || token.length < 20) return null;
  const session = await tx.session.findUnique({
    where: { tokenHash: sha256Hex(token) },
    include: { user: { include: { permissions: true } } },
  });
  if (!session) return null;
  if (session.revokedAt) return null;
  if (session.expiresAt.getTime() <= now.getTime()) return null;
  if (session.lastSeenAt.getTime() + SESSION_IDLE_MS <= now.getTime()) {
    await tx.session.update({
      where: { id: session.id },
      data: { revokedAt: now, revokeReason: "idle timeout" },
    });
    return null;
  }
  if (!session.user.isActive) return null;
  if (now.getTime() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await tx.session.update({ where: { id: session.id }, data: { lastSeenAt: now } });
  }
  return {
    session: {
      id: session.id,
      userId: session.userId,
      mfaVerifiedAt: session.mfaVerifiedAt,
      createdAt: session.createdAt,
      lastSeenAt: session.lastSeenAt,
      expiresAt: session.expiresAt,
    },
    user: {
      id: session.user.id,
      email: session.user.email,
      displayName: session.user.displayName,
      role: session.user.role,
      isActive: session.user.isActive,
      mfaEnrolledAt: session.user.mfaEnrolledAt,
      permissions: session.user.permissions.map((p) => p.permission),
    },
  };
}

/**
 * Completes MFA: the session becomes fully open, gets its full lifetime, and its token is rotated so the
 * cookie value issued before MFA never becomes a privileged credential. Returns the new token.
 */
export async function markSessionMfaVerified(
  tx: DbOrTx,
  sessionId: string,
  now = new Date(),
): Promise<string> {
  const token = randomToken(32);
  await tx.session.update({
    where: { id: sessionId },
    data: {
      mfaVerifiedAt: now,
      tokenHash: sha256Hex(token),
      expiresAt: new Date(now.getTime() + SESSION_ABSOLUTE_MS),
      lastSeenAt: now,
    },
  });
  return token;
}

export async function revokeSession(
  tx: DbOrTx,
  sessionId: string,
  reason: string,
  actor?: { userId: string } & RequestMeta,
): Promise<void> {
  const now = new Date();
  await tx.session.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: now, revokeReason: reason },
  });
  if (actor) {
    await audit(tx, {
      action: "session.sign_out",
      userId: actor.userId,
      sessionId,
      reason,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
  }
}

/** "Sign out everywhere": revokes every live session of a user (optionally keeping the current one). */
export async function revokeAllSessions(
  tx: DbOrTx,
  userId: string,
  reason: string,
  actor: { userId: string; sessionId?: string | null } & RequestMeta,
  opts: { keepSessionId?: string | null } = {},
): Promise<number> {
  const now = new Date();
  const result = await tx.session.updateMany({
    where: {
      userId,
      revokedAt: null,
      ...(opts.keepSessionId ? { id: { not: opts.keepSessionId } } : {}),
    },
    data: { revokedAt: now, revokeReason: reason },
  });
  await audit(tx, {
    action: "session.sign_out_everywhere",
    userId: actor.userId,
    sessionId: actor.sessionId ?? null,
    subjectType: "user",
    subjectId: userId,
    reason,
    after: { revoked: result.count },
    ip: actor.ip,
    userAgent: actor.userAgent,
  });
  return result.count;
}

/** Cookie attributes for the session cookie. `Secure` is dropped only on plain-http localhost. */
export function sessionCookieOptions(appUrl: string) {
  const secure = !appUrl.startsWith("http://localhost") && !appUrl.startsWith("http://127.0.0.1");
  return {
    name: SESSION_COOKIE,
    httpOnly: true as const,
    secure,
    sameSite: "lax" as const,
    path: "/",
    maxAge: Math.floor(SESSION_ABSOLUTE_MS / 1000),
  };
}
