"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  ForbiddenError,
  requestMeta,
  requireOwner,
  requirePermission,
  UnauthenticatedError,
  type CurrentUser,
} from "@/lib/auth/current-user";
import { LedgerError } from "@/lib/ledger/errors";
import { closeTaxYear, fileTaxYear, reopenTaxYear, setChecklistItem } from "@/lib/ledger/tax-years";

export type TaxYearResult = { ok?: boolean; error?: string };

const uuid = z.string().uuid();

async function actorFor(user: CurrentUser) {
  const meta = await requestMeta();
  return { userId: user.id, sessionId: user.sessionId, ...meta };
}

async function run(work: () => Promise<void>): Promise<TaxYearResult> {
  try {
    await work();
    revalidatePath("/tax-years", "layout");
    revalidatePath("/ledger");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (err) {
    if (
      err instanceof LedgerError ||
      err instanceof ForbiddenError ||
      err instanceof UnauthenticatedError
    )
      return { error: err.message };
    throw err;
  }
}

const checklistSchema = z.object({
  taxYearId: uuid,
  itemKey: z.string().min(1).max(60),
  done: z.boolean(),
  overrideReason: z.string().trim().max(1000).optional().default(""),
});

export async function setChecklistItemAction(
  input: z.input<typeof checklistSchema>,
): Promise<TaxYearResult> {
  const parsed = checklistSchema.safeParse(input);
  if (!parsed.success) return { error: "Something is missing; reload the page and try again." };
  const d = parsed.data;
  return run(async () => {
    const user = await requirePermission("CLOSE_YEAR");
    const actor = await actorFor(user);
    await db.$transaction((tx) =>
      setChecklistItem(tx, actor, d.taxYearId, d.itemKey, {
        done: d.done,
        overrideReason: d.overrideReason || null,
      }),
    );
  });
}

const yearSchema = z.object({
  taxYearId: uuid,
  note: z.string().trim().max(1000).optional().default(""),
});

export async function closeTaxYearAction(
  input: z.input<typeof yearSchema>,
): Promise<TaxYearResult> {
  const parsed = yearSchema.safeParse(input);
  if (!parsed.success) return { error: "That tax year could not be found." };
  return run(async () => {
    const user = await requirePermission("CLOSE_YEAR");
    const actor = await actorFor(user);
    await db.$transaction((tx) =>
      closeTaxYear(tx, actor, parsed.data.taxYearId, parsed.data.note || null),
    );
  });
}

export async function fileTaxYearAction(input: z.input<typeof yearSchema>): Promise<TaxYearResult> {
  const parsed = yearSchema.safeParse(input);
  if (!parsed.success) return { error: "That tax year could not be found." };
  return run(async () => {
    const user = await requirePermission("CLOSE_YEAR");
    const actor = await actorFor(user);
    await db.$transaction((tx) =>
      fileTaxYear(tx, actor, parsed.data.taxYearId, parsed.data.note || null),
    );
  });
}

const reopenSchema = z.object({ taxYearId: uuid, reason: z.string().trim().max(1000) });

export async function reopenTaxYearAction(
  input: z.input<typeof reopenSchema>,
): Promise<TaxYearResult> {
  const parsed = reopenSchema.safeParse(input);
  if (!parsed.success) return { error: "That tax year could not be found." };
  return run(async () => {
    const user = await requireOwner("REOPEN_YEAR");
    const actor = await actorFor(user);
    await db.$transaction((tx) =>
      reopenTaxYear(tx, actor, parsed.data.taxYearId, parsed.data.reason),
    );
  });
}
