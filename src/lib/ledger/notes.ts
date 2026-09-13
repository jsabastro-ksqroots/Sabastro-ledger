import type { DbOrTx } from "@/lib/db";
import { audit } from "@/lib/audit";
import type { RequestMeta } from "@/lib/auth/session";
import { LedgerError } from "./errors";

/**
 * Notes on a transaction. System notes are append-only and timestamped (the database trigger enforces
 * it); a transaction has at most one user note, which is free text edited with an audit row.
 */

export type NoteActor = { userId: string; sessionId: string | null } & RequestMeta;

export const USER_NOTE_MAX = 4000;
export const SYSTEM_NOTE_MAX = 8000;

export async function addSystemNote(
  tx: DbOrTx,
  transactionId: string,
  body: string,
  createdById: string | null = null,
): Promise<void> {
  const text = body.trim().slice(0, SYSTEM_NOTE_MAX);
  if (!text) return;
  await tx.note.create({
    data: { transactionId, kind: "SYSTEM", body: text, createdById, updatedById: createdById },
  });
}

/** Creates, replaces or blanks the user note. An empty body keeps the row but empties it (nothing is deleted). */
export async function setUserNote(
  tx: DbOrTx,
  actor: NoteActor,
  transactionId: string,
  body: string,
): Promise<string> {
  const text = body.trim();
  if (text.length > USER_NOTE_MAX)
    throw new LedgerError(
      `The note is too long (${USER_NOTE_MAX.toLocaleString()} characters at most).`,
    );
  const transaction = await tx.transaction.findUnique({
    where: { id: transactionId },
    select: { id: true, seq: true, entityId: true, vendor: true },
  });
  if (!transaction) throw new LedgerError("That transaction no longer exists.");
  const existing = await tx.note.findFirst({ where: { transactionId, kind: "USER" } });
  if (existing && existing.body === text) return text;
  if (existing) {
    await tx.note.update({
      where: { id: existing.id },
      data: { body: text, updatedById: actor.userId },
    });
  } else if (text) {
    await tx.note.create({
      data: {
        transactionId,
        kind: "USER",
        body: text,
        createdById: actor.userId,
        updatedById: actor.userId,
      },
    });
  } else {
    return text;
  }
  await audit(tx, {
    action: "transaction.note",
    userId: actor.userId,
    sessionId: actor.sessionId,
    subjectType: "transaction",
    subjectId: transactionId,
    subjectLabel: `#${transaction.seq} ${transaction.vendor ?? ""}`.trim(),
    entityId: transaction.entityId,
    before: { userNote: existing?.body ?? null },
    after: { userNote: text || null },
    ip: actor.ip,
    userAgent: actor.userAgent,
  });
  return text;
}
