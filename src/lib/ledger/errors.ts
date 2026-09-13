/**
 * Errors the ledger core throws. Server actions turn these into messages for the two users;
 * anything else is a real bug and is re-thrown.
 */

/** A validation problem worded for the users; shown as-is. */
export class LedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerError";
  }
}

export interface LockedYear {
  taxYearId: string;
  entityId: string;
  entityCode: string;
  year: number;
  state: "CLOSED" | "FILED";
  overrideCount: number;
}

/**
 * The write touches a closed or filed tax year and no override reason was given. The UI shows the
 * full-screen warning listing `years`, collects a typed reason, and retries with it.
 */
export class LockedYearError extends Error {
  readonly years: LockedYear[];
  constructor(years: LockedYear[]) {
    super(
      `This change touches ${years.map((y) => `${y.entityCode} ${y.year} (${y.state.toLowerCase()})`).join(", ")}, which is locked.`,
    );
    this.name = "LockedYearError";
    this.years = years;
  }
}

/** Translates a Postgres trigger/constraint message into words the users understand. */
export function translateLedgerDbError(err: unknown): never {
  const message = err instanceof Error ? err.message : String(err);
  const m = message.match(/LOCKED_YEAR: tax year (\d{4}) is (\w+)/);
  if (m) {
    throw new LedgerError(
      `Tax year ${m[1]} is ${m[2]} and cannot be changed without an override reason.`,
    );
  }
  if (/does not balance/i.test(message))
    throw new LedgerError(
      "The entry does not balance: debits must equal credits for each business.",
    );
  if (/needs at least two lines/i.test(message))
    throw new LedgerError("A transaction needs at least two lines.");
  if (/cannot be posted: every line/i.test(message))
    throw new LedgerError(
      "Every line needs an account and a class before the transaction can be posted.",
    );
  if (/split lines must add up/i.test(message))
    throw new LedgerError("The split lines must add up to the amount they replace.");
  if (/transaction_lines_amounts/i.test(message))
    throw new LedgerError("Each line must have either a debit or a credit, greater than zero.");
  if (/transactions_voided_fields/i.test(message))
    throw new LedgerError("A voided transaction needs a reason.");
  if (
    /never deleted|cannot be changed; supersede|superseded line is immutable|voided transaction cannot be changed/i.test(
      message,
    )
  )
    throw new LedgerError(
      "Posted lines cannot be edited in place; the app records a new version instead.",
    );
  if (/belongs to that bank account|belongs to the entity of its class|home entity/i.test(message))
    throw new LedgerError(
      "A line ended up attributed to the wrong business. Please try again; if it repeats, report it.",
    );
  if (/System notes are append-only/i.test(message))
    throw new LedgerError("System notes cannot be edited or deleted.");
  throw err;
}
