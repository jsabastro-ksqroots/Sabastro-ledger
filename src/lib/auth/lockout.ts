import type { DbOrTx } from "@/lib/db";
import { audit } from "@/lib/audit";
import type { RequestMeta } from "@/lib/auth/session";

/** Five failures (password or MFA) within the window lock the account; each repeat doubles the lock. */
export const FAILURE_THRESHOLD = 5;
export const FAILURE_WINDOW_MS = 15 * 60 * 1000;
export const LOCK_BASE_MS = 15 * 60 * 1000;
export const LOCK_MAX_MS = 24 * 60 * 60 * 1000;
/** Thirty failures from one IP address in the window throttle that address (any email). */
export const IP_FAILURE_THRESHOLD = 30;

export async function recordAttempt(
  tx: DbOrTx,
  email: string,
  ip: string | null | undefined,
  succeeded: boolean,
): Promise<void> {
  await tx.loginAttempt.create({ data: { email, ip: ip ?? "unknown", succeeded } });
}

export async function ipIsThrottled(
  tx: DbOrTx,
  ip: string | null | undefined,
  now = new Date(),
): Promise<boolean> {
  if (!ip) return false;
  const since = new Date(now.getTime() - FAILURE_WINDOW_MS);
  const failures = await tx.loginAttempt.count({
    where: { ip, succeeded: false, attemptedAt: { gt: since } },
  });
  return failures >= IP_FAILURE_THRESHOLD;
}

export function lockDurationMs(lockoutCount: number): number {
  return Math.min(LOCK_BASE_MS * 2 ** Math.max(0, lockoutCount), LOCK_MAX_MS);
}

/**
 * Registers a failed password or MFA attempt against a user. Locks the account on the fifth failure.
 * Returns the lock expiry when a lock is (now) in force.
 */
export async function registerFailure(
  tx: DbOrTx,
  user: {
    id: string;
    email: string;
    failedLoginCount: number;
    lockoutCount: number;
    lockedUntil: Date | null;
  },
  kind: "password" | "mfa" | "recovery",
  meta: RequestMeta,
  now = new Date(),
): Promise<{ lockedUntil: Date | null }> {
  await recordAttempt(tx, user.email, meta.ip, false);
  const failed = user.failedLoginCount + 1;
  if (failed >= FAILURE_THRESHOLD) {
    const lockedUntil = new Date(now.getTime() + lockDurationMs(user.lockoutCount));
    await tx.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockoutCount: { increment: 1 }, lockedUntil },
    });
    await audit(tx, {
      action: "login.lockout",
      userId: user.id,
      subjectType: "user",
      subjectId: user.id,
      subjectLabel: user.email,
      after: { kind, lockedUntil: lockedUntil.toISOString(), failures: failed },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return { lockedUntil };
  }
  await tx.user.update({ where: { id: user.id }, data: { failedLoginCount: failed } });
  await audit(tx, {
    action: kind === "password" ? "login.failed" : "mfa.failed",
    userId: user.id,
    subjectType: "user",
    subjectId: user.id,
    subjectLabel: user.email,
    after: { kind, failures: failed },
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
  return { lockedUntil: null };
}

export async function clearFailures(tx: DbOrTx, userId: string, now = new Date()): Promise<void> {
  await tx.user.update({
    where: { id: userId },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now },
  });
}

export function secondsUntil(date: Date, now = new Date()): number {
  return Math.max(1, Math.ceil((date.getTime() - now.getTime()) / 1000));
}
