import type { Prisma } from "@/generated/prisma/client";
import type { DbOrTx } from "@/lib/db";
import { audit } from "@/lib/audit";
import type { RequestMeta } from "@/lib/auth/session";
import { LedgerError } from "./errors";

/** Named grid views (filters, sort, columns), private to the user who saved them. */

export type ViewActor = { userId: string; sessionId: string | null } & RequestMeta;

export interface SavedViewRow {
  id: string;
  name: string;
  state: unknown;
}

export async function listSavedViews(
  tx: DbOrTx,
  userId: string,
  page: string,
): Promise<SavedViewRow[]> {
  const rows = await tx.savedView.findMany({
    where: { userId, page },
    orderBy: { name: "asc" },
    select: { id: true, name: true, state: true },
  });
  return rows;
}

export async function saveView(
  tx: DbOrTx,
  actor: ViewActor,
  page: string,
  name: string,
  state: unknown,
): Promise<SavedViewRow> {
  const cleaned = name.trim().replace(/\s+/g, " ");
  if (!cleaned) throw new LedgerError("Give the view a name.");
  if (cleaned.length > 60) throw new LedgerError("Keep the view name under 60 characters.");
  const json = JSON.stringify(state ?? {});
  if (json.length > 20_000) throw new LedgerError("That view is too large to save.");
  const row = await tx.savedView.upsert({
    where: { userId_page_name: { userId: actor.userId, page, name: cleaned } },
    create: { userId: actor.userId, page, name: cleaned, state: state as Prisma.InputJsonValue },
    update: { state: state as Prisma.InputJsonValue },
    select: { id: true, name: true, state: true },
  });
  await audit(tx, {
    action: "saved_view.save",
    userId: actor.userId,
    sessionId: actor.sessionId,
    subjectType: "saved_view",
    subjectId: row.id,
    subjectLabel: `${page}: ${cleaned}`,
    after: { page, name: cleaned },
    ip: actor.ip,
    userAgent: actor.userAgent,
  });
  return row;
}

export async function deleteView(tx: DbOrTx, actor: ViewActor, id: string): Promise<void> {
  const row = await tx.savedView.findUnique({ where: { id } });
  if (!row || row.userId !== actor.userId)
    throw new LedgerError("That saved view no longer exists.");
  await tx.savedView.delete({ where: { id } });
  await audit(tx, {
    action: "saved_view.delete",
    userId: actor.userId,
    sessionId: actor.sessionId,
    subjectType: "saved_view",
    subjectId: id,
    subjectLabel: `${row.page}: ${row.name}`,
    before: { page: row.page, name: row.name },
    ip: actor.ip,
    userAgent: actor.userAgent,
  });
}
