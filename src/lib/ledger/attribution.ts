/**
 * Entity attribution of a transaction line (docs/DESIGN.md §3, docs/DECISIONS.md P0-24).
 *
 * Every line belongs to exactly one entity, decided in this order:
 *  1. a line on a bank account's ledger account belongs to that bank account's entity, whatever class it
 *     carries (the bank line carries the same class as the row it paid for, as the 2019–2024 books do);
 *  2. any other line belongs to the entity of its class (Providence → PLA, Rentals:* → SREI);
 *  3. a General (shared-class) line belongs to the transaction's home entity.
 * Bridge lines are the exception to rule 3: the payer's General-class line carries the payer's entity,
 * which is why the caller passes the entity for bridge lines explicitly.
 *
 * The database re-checks rules 1–3 with a trigger; this function is what the app uses to fill the column.
 */

export interface AttributionContext {
  /** The bank account's entity (bank-centric rows) or the entity chosen for a manual journal. */
  homeEntityId: string;
  /** Ledger account id → entity id, for every bank account's ledger account. */
  bankEntityByAccountId: ReadonlyMap<string, string>;
  /** Class id → who owns it and whether it is the shared General class. */
  classes: ReadonlyMap<string, { entityId: string; isShared: boolean }>;
}

export function resolveLineEntity(
  line: { accountId: string | null; classId: string | null },
  ctx: AttributionContext,
): string {
  if (line.accountId) {
    const bankEntity = ctx.bankEntityByAccountId.get(line.accountId);
    if (bankEntity) return bankEntity;
  }
  if (line.classId) {
    const cls = ctx.classes.get(line.classId);
    if (cls && !cls.isShared) return cls.entityId;
  }
  return ctx.homeEntityId;
}

/** True when the ledger account is the account behind a bank account (a "bank line"). */
export function isBankLedgerAccount(accountId: string | null, ctx: AttributionContext): boolean {
  return !!accountId && ctx.bankEntityByAccountId.has(accountId);
}
