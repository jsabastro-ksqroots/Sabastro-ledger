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
import { userCan } from "@/lib/auth/current-user";
import { parseAmountToCents } from "@/lib/money";
import { LedgerError, LockedYearError, type LockedYear } from "@/lib/ledger/errors";
import {
  createBankTransaction,
  createJournalEntry,
  loadTransaction,
  postTransaction,
  setFlag,
  setLineAccountClass,
  splitLine,
  unsplitLine,
  updateBankTransaction,
  updateJournalEntry,
  voidTransaction,
  type Actor,
} from "@/lib/ledger/transactions";
import { setUserNote } from "@/lib/ledger/notes";
import { getTransactionDetail, type TransactionDetail } from "@/lib/ledger/query";
import { deleteView, listSavedViews, saveView, type SavedViewRow } from "@/lib/ledger/saved-views";
import { parsePercentToBp } from "@/lib/ledger/split";

/**
 * Server actions for the ledger. Every action resolves the session, checks the permission on the
 * server, runs the core inside one database transaction, and returns a plain result the client can
 * show. A locked tax year comes back as `needsOverride` so the UI can show the full-screen warning and
 * retry with the typed reason.
 */

export type LedgerResult = {
  ok?: boolean;
  error?: string;
  needsOverride?: { years: LockedYear[] };
  transactionId?: string;
};

const PAGES = ["/ledger", "/dashboard", "/tax-years"];

function revalidate() {
  for (const p of PAGES) revalidatePath(p);
}

async function actorFor(user: CurrentUser): Promise<Actor> {
  const meta = await requestMeta();
  return { userId: user.id, sessionId: user.sessionId, role: user.role, ...meta };
}

/** Creating, confirming and editing drafts needs "Review and confirm"; touching a posted row needs "Edit posted". */
async function requireLedgerWriter(target: { status: string } | null): Promise<CurrentUser> {
  const user = await requireUser();
  const needed =
    target && (target.status === "POSTED" || target.status === "VOIDED")
      ? "EDIT_POSTED"
      : "REVIEW_CONFIRM";
  if (!userCan(user, needed)) {
    throw new ForbiddenError(
      needed === "EDIT_POSTED"
        ? "Editing a posted transaction needs the “Edit posted transactions” permission."
        : "Creating and confirming transactions needs the “Review and confirm” permission.",
    );
  }
  return user;
}

async function run(work: () => Promise<LedgerResult | void>): Promise<LedgerResult> {
  try {
    const result = await work();
    revalidate();
    return { ok: true, ...(result ?? {}) };
  } catch (err) {
    if (err instanceof LockedYearError) return { needsOverride: { years: err.years } };
    if (
      err instanceof LedgerError ||
      err instanceof ForbiddenError ||
      err instanceof UnauthenticatedError
    )
      return { error: err.message };
    throw err;
  }
}

const uuid = z.string().uuid();
const reasonField = z.string().trim().max(1000).optional().default("");
const overrideField = z.string().trim().max(1000).optional().nullable();

function cents(label: string) {
  return z
    .string()
    .trim()
    .transform((v, ctx) => {
      const parsed = parseAmountToCents(v);
      if (parsed === null) {
        ctx.addIssue({
          code: "custom",
          message: `${label} must be a number like -135.15 or 1,200.00.`,
        });
        return z.NEVER;
      }
      return parsed;
    });
}

function firstIssue(err: z.ZodError, fallback: string): string {
  return err.issues[0]?.message ?? fallback;
}

// ---------------------------------------------------------------------------
// Simple rows
// ---------------------------------------------------------------------------

const bankTransactionSchema = z.object({
  bankAccountId: uuid,
  date: z.string().trim(),
  vendor: z.string().trim().max(200),
  amount: cents("Amount"),
  accountId: uuid,
  classId: uuid,
  memo: z.string().trim().max(2000).optional().default(""),
  userNote: z.string().trim().max(4000).optional().default(""),
  post: z.enum(["true", "false"]).optional().default("true"),
  lockOverrideReason: overrideField,
});

export type BankTransactionInput = z.input<typeof bankTransactionSchema>;

export async function createBankTransactionAction(
  input: BankTransactionInput,
): Promise<LedgerResult> {
  const parsed = bankTransactionSchema.safeParse(input);
  if (!parsed.success)
    return { error: firstIssue(parsed.error, "Check the form: something is missing.") };
  const d = parsed.data;
  return run(async () => {
    const user = await requireLedgerWriter(null);
    const actor = await actorFor(user);
    const t = await db.$transaction((tx) =>
      createBankTransaction(
        tx,
        actor,
        {
          bankAccountId: d.bankAccountId,
          date: d.date,
          vendor: d.vendor,
          amountCents: d.amount,
          accountId: d.accountId,
          classId: d.classId,
          memo: d.memo || null,
          userNote: d.userNote || null,
          post: d.post === "true",
        },
        { lockOverrideReason: d.lockOverrideReason ?? null },
      ),
    );
    return { transactionId: t.id };
  });
}

const bankUpdateSchema = z.object({
  id: uuid,
  date: z.string().trim().optional(),
  vendor: z.string().trim().max(200).optional(),
  memo: z.string().trim().max(2000).optional(),
  bankAccountId: uuid.optional(),
  amount: cents("Amount").optional(),
  accountId: uuid.optional(),
  classId: uuid.optional(),
  lockOverrideReason: overrideField,
});

export type BankUpdateInput = z.input<typeof bankUpdateSchema>;

export async function updateBankTransactionAction(input: BankUpdateInput): Promise<LedgerResult> {
  const parsed = bankUpdateSchema.safeParse(input);
  if (!parsed.success)
    return { error: firstIssue(parsed.error, "Check the form: something is missing.") };
  const d = parsed.data;
  return run(async () => {
    const existing = await db.transaction.findUnique({
      where: { id: d.id },
      select: { status: true },
    });
    if (!existing) throw new LedgerError("That transaction no longer exists.");
    const user = await requireLedgerWriter(existing);
    const actor = await actorFor(user);
    await db.$transaction((tx) =>
      updateBankTransaction(
        tx,
        actor,
        d.id,
        {
          date: d.date,
          vendor: d.vendor,
          memo: d.memo,
          bankAccountId: d.bankAccountId,
          amountCents: d.amount,
          accountId: d.accountId,
          classId: d.classId,
        },
        { lockOverrideReason: d.lockOverrideReason ?? null },
      ),
    );
    return { transactionId: d.id };
  });
}

// ---------------------------------------------------------------------------
// Journal entries
// ---------------------------------------------------------------------------

const journalLineSchema = z.object({
  accountId: z.string().optional().default(""),
  classId: z.string().optional().default(""),
  debit: z.string().trim().optional().default(""),
  credit: z.string().trim().optional().default(""),
  memo: z.string().trim().max(500).optional().default(""),
});

const journalSchema = z.object({
  id: uuid.optional(),
  entityId: uuid,
  date: z.string().trim(),
  vendor: z.string().trim().max(200),
  memo: z.string().trim().max(2000).optional().default(""),
  adjusting: z.boolean().optional().default(false),
  lines: z.array(journalLineSchema).min(2, "A journal entry needs at least two lines."),
  userNote: z.string().trim().max(4000).optional().default(""),
  post: z.boolean().optional().default(true),
  lockOverrideReason: overrideField,
});

export type JournalInput = z.input<typeof journalSchema>;

function journalLines(lines: z.infer<typeof journalLineSchema>[]) {
  return lines.map((l, i) => {
    const debit = l.debit ? parseAmountToCents(l.debit) : 0n;
    const credit = l.credit ? parseAmountToCents(l.credit) : 0n;
    if (debit === null || credit === null)
      throw new LedgerError(`Line ${i + 1}: amounts must be numbers like 1,200.00.`);
    if (debit < 0n || credit < 0n)
      throw new LedgerError(
        `Line ${i + 1}: enter the amount without a minus sign in the Debit or Credit column.`,
      );
    return {
      accountId: l.accountId || null,
      classId: l.classId || null,
      debitCents: debit,
      creditCents: credit,
      memo: l.memo || null,
    };
  });
}

export async function saveJournalEntryAction(input: JournalInput): Promise<LedgerResult> {
  const parsed = journalSchema.safeParse(input);
  if (!parsed.success)
    return { error: firstIssue(parsed.error, "Check the form: something is missing.") };
  const d = parsed.data;
  return run(async () => {
    const lines = journalLines(d.lines);
    if (d.id) {
      const existing = await db.transaction.findUnique({
        where: { id: d.id },
        select: { status: true },
      });
      if (!existing) throw new LedgerError("That transaction no longer exists.");
      const user = await requireLedgerWriter(existing);
      const actor = await actorFor(user);
      await db.$transaction((tx) =>
        updateJournalEntry(
          tx,
          actor,
          d.id as string,
          {
            entityId: d.entityId,
            date: d.date,
            vendor: d.vendor,
            memo: d.memo,
            adjusting: d.adjusting,
            lines,
          },
          { lockOverrideReason: d.lockOverrideReason ?? null },
        ),
      );
      return { transactionId: d.id };
    }
    const user = await requireLedgerWriter(null);
    const actor = await actorFor(user);
    const t = await db.$transaction((tx) =>
      createJournalEntry(
        tx,
        actor,
        {
          entityId: d.entityId,
          date: d.date,
          vendor: d.vendor,
          memo: d.memo || null,
          adjusting: d.adjusting,
          lines,
          userNote: d.userNote || null,
          post: d.post,
        },
        { lockOverrideReason: d.lockOverrideReason ?? null },
      ),
    );
    return { transactionId: t.id };
  });
}

// ---------------------------------------------------------------------------
// Inline edit, split, unsplit
// ---------------------------------------------------------------------------

const lineEditSchema = z.object({
  lineId: uuid,
  accountId: uuid.optional(),
  classId: uuid.optional(),
  lockOverrideReason: overrideField,
});

export async function setLineAccountClassAction(
  input: z.input<typeof lineEditSchema>,
): Promise<LedgerResult> {
  const parsed = lineEditSchema.safeParse(input);
  if (!parsed.success) return { error: "Pick an account or a class." };
  const d = parsed.data;
  if (!d.accountId && !d.classId) return { error: "Pick an account or a class." };
  return run(async () => {
    const line = await db.transactionLine.findUnique({
      where: { id: d.lineId },
      select: { transaction: { select: { id: true, status: true } } },
    });
    if (!line) throw new LedgerError("That line no longer exists.");
    const user = await requireLedgerWriter(line.transaction);
    const actor = await actorFor(user);
    await db.$transaction((tx) =>
      setLineAccountClass(
        tx,
        actor,
        d.lineId,
        { accountId: d.accountId, classId: d.classId },
        { lockOverrideReason: d.lockOverrideReason ?? null },
      ),
    );
    return { transactionId: line.transaction.id };
  });
}

const splitSchema = z.object({
  lineId: uuid,
  mode: z.enum(["amount", "percent"]),
  parts: z
    .array(
      z.object({
        accountId: z.string(),
        classId: z.string(),
        value: z.string().trim(),
        memo: z.string().trim().max(500).optional().default(""),
      }),
    )
    .min(2, "A split needs at least two lines."),
  lockOverrideReason: overrideField,
});

export type SplitInput = z.input<typeof splitSchema>;

export async function splitLineAction(input: SplitInput): Promise<LedgerResult> {
  const parsed = splitSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error, "Check the split lines.") };
  const d = parsed.data;
  return run(async () => {
    const line = await db.transactionLine.findUnique({
      where: { id: d.lineId },
      select: { transaction: { select: { id: true, status: true } } },
    });
    if (!line) throw new LedgerError("That line no longer exists.");
    const user = await requireLedgerWriter(line.transaction);
    const actor = await actorFor(user);
    const parts = d.parts.map((p, i) => {
      if (d.mode === "amount") {
        const amount = parseAmountToCents(p.value);
        if (amount === null) throw new LedgerError(`Line ${i + 1}: enter an amount like 60.00.`);
        return {
          accountId: p.accountId,
          classId: p.classId,
          amountCents: amount < 0n ? -amount : amount,
          memo: p.memo || null,
        };
      }
      const bp = parsePercentToBp(p.value);
      if (bp === null) throw new LedgerError(`Line ${i + 1}: enter a percentage like 33.33.`);
      return { accountId: p.accountId, classId: p.classId, percentBp: bp, memo: p.memo || null };
    });
    await db.$transaction((tx) =>
      splitLine(tx, actor, d.lineId, parts, d.mode, {
        lockOverrideReason: d.lockOverrideReason ?? null,
      }),
    );
    return { transactionId: line.transaction.id };
  });
}

const unsplitSchema = z.object({
  parentLineId: uuid,
  accountId: uuid.optional(),
  classId: uuid.optional(),
  lockOverrideReason: overrideField,
});

export async function unsplitLineAction(
  input: z.input<typeof unsplitSchema>,
): Promise<LedgerResult> {
  const parsed = unsplitSchema.safeParse(input);
  if (!parsed.success) return { error: "That line could not be found." };
  const d = parsed.data;
  return run(async () => {
    const line = await db.transactionLine.findUnique({
      where: { id: d.parentLineId },
      select: { transaction: { select: { id: true, status: true } } },
    });
    if (!line) throw new LedgerError("That line no longer exists.");
    const user = await requireLedgerWriter(line.transaction);
    const actor = await actorFor(user);
    await db.$transaction((tx) =>
      unsplitLine(
        tx,
        actor,
        d.parentLineId,
        { accountId: d.accountId, classId: d.classId },
        { lockOverrideReason: d.lockOverrideReason ?? null },
      ),
    );
    return { transactionId: line.transaction.id };
  });
}

// ---------------------------------------------------------------------------
// Post, void, flag, notes
// ---------------------------------------------------------------------------

const idWithOverride = z.object({ id: uuid, lockOverrideReason: overrideField });

export async function postTransactionAction(
  input: z.input<typeof idWithOverride>,
): Promise<LedgerResult> {
  const parsed = idWithOverride.safeParse(input);
  if (!parsed.success) return { error: "That transaction could not be found." };
  const d = parsed.data;
  return run(async () => {
    const user = await requirePermission("REVIEW_CONFIRM");
    const actor = await actorFor(user);
    await db.$transaction((tx) =>
      postTransaction(tx, actor, d.id, { lockOverrideReason: d.lockOverrideReason ?? null }),
    );
    return { transactionId: d.id };
  });
}

const voidSchema = z.object({ id: uuid, reason: reasonField, lockOverrideReason: overrideField });

export async function voidTransactionAction(
  input: z.input<typeof voidSchema>,
): Promise<LedgerResult> {
  const parsed = voidSchema.safeParse(input);
  if (!parsed.success) return { error: "That transaction could not be found." };
  const d = parsed.data;
  return run(async () => {
    const existing = await db.transaction.findUnique({
      where: { id: d.id },
      select: { status: true },
    });
    if (!existing) throw new LedgerError("That transaction no longer exists.");
    const user = await requireLedgerWriter(existing);
    const actor = await actorFor(user);
    await db.$transaction((tx) =>
      voidTransaction(tx, actor, d.id, d.reason, {
        lockOverrideReason: d.lockOverrideReason ?? null,
      }),
    );
    return { transactionId: d.id };
  });
}

const flagSchema = z.object({ id: uuid, flagged: z.boolean(), reason: reasonField });

export async function setFlagAction(input: z.input<typeof flagSchema>): Promise<LedgerResult> {
  const parsed = flagSchema.safeParse(input);
  if (!parsed.success) return { error: "That transaction could not be found." };
  const d = parsed.data;
  return run(async () => {
    const user = await requirePermission("REVIEW_CONFIRM");
    const actor = await actorFor(user);
    await db.$transaction((tx) => setFlag(tx, actor, d.id, d.flagged, d.reason || null));
    return { transactionId: d.id };
  });
}

const noteSchema = z.object({ id: uuid, body: z.string().max(4000) });

export async function setUserNoteAction(input: z.input<typeof noteSchema>): Promise<LedgerResult> {
  const parsed = noteSchema.safeParse(input);
  if (!parsed.success) return { error: "The note is too long (4,000 characters at most)." };
  const d = parsed.data;
  return run(async () => {
    // Notes never change the numbers, so anyone who can confirm may write one (posted rows included).
    const user = await requirePermission("REVIEW_CONFIRM");
    const actor = await actorFor(user);
    await db.$transaction((tx) => setUserNote(tx, actor, d.id, d.body));
    return { transactionId: d.id };
  });
}

// ---------------------------------------------------------------------------
// Reads used by the client (details drawer) and saved views
// ---------------------------------------------------------------------------

export async function getTransactionDetailAction(id: string): Promise<TransactionDetail | null> {
  await requirePermission("VIEW_LEDGER");
  if (!uuid.safeParse(id).success) return null;
  return getTransactionDetail(db, id);
}

export async function reloadTransactionAction(id: string): Promise<{ ok: boolean }> {
  await requirePermission("VIEW_LEDGER");
  await loadTransaction(db, id).catch(() => null);
  return { ok: true };
}

const viewSchema = z.object({ name: z.string().trim().min(1).max(60), state: z.unknown() });

export async function saveViewAction(
  input: z.input<typeof viewSchema>,
): Promise<LedgerResult & { views?: SavedViewRow[] }> {
  const parsed = viewSchema.safeParse(input);
  if (!parsed.success) return { error: "Give the view a short name." };
  try {
    const user = await requirePermission("VIEW_LEDGER");
    const actor = await actorFor(user);
    await db.$transaction((tx) =>
      saveView(tx, actor, "ledger", parsed.data.name, parsed.data.state),
    );
    const views = await listSavedViews(db, user.id, "ledger");
    return { ok: true, views };
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

export async function deleteViewAction(
  id: string,
): Promise<LedgerResult & { views?: SavedViewRow[] }> {
  if (!uuid.safeParse(id).success) return { error: "That view could not be found." };
  try {
    const user = await requirePermission("VIEW_LEDGER");
    const actor = await actorFor(user);
    await db.$transaction((tx) => deleteView(tx, actor, id));
    const views = await listSavedViews(db, user.id, "ledger");
    return { ok: true, views };
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
