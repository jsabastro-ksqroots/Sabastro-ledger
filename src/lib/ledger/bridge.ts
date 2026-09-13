/**
 * The cross-entity bridge (CLAUDE.md "Entity attribution", docs/DESIGN.md §3, DECISIONS P0-24).
 *
 * After the ordinary lines of a transaction are known, each entity's net is computed
 * (Σ debit − Σ credit of its non-bridge live lines). An entity with a negative net is a payer and gets
 * one debit line on the payer account (default 3102 Capital Distribution) with class General for the
 * shortfall; an entity with a positive net is a receiver and gets credit lines on the receiver account
 * (default 3101 Capital Contribution), one per class it received, for the excess. The money moved through
 * Jose, who owns every entity. Money out, money in, splits and multi-entity journals all fall out of the
 * same arithmetic. The accounts come from Settings (one rule per ordered entity pair); the alternative
 * "intercompany" mode uses the same arithmetic with due-from / due-to accounts.
 *
 * Pure: no database access. The database's per-entity balance trigger is the safety net behind it.
 */

export interface BridgeInputLine {
  entityId: string;
  classId: string | null;
  debitCents: bigint;
  creditCents: bigint;
  isBridge: boolean;
}

export interface BridgeRule {
  payerEntityId: string;
  receiverEntityId: string;
  payerAccountId: string;
  receiverAccountId: string;
}

export interface BridgeOptions {
  rules: readonly BridgeRule[];
  /** The shared General class: the payer's bridge line carries it. */
  generalClassId: string;
  /** Used when no rule exists for an entity pair (3102 / 3101 by default, seeded in Settings). */
  defaultPayerAccountId: string;
  defaultReceiverAccountId: string;
  /** Entity id → short code, for the memo ("Cross-entity bridge: SREI paid for PLA"). */
  entityCodes?: ReadonlyMap<string, string>;
}

export interface BridgeLineSpec {
  entityId: string;
  accountId: string;
  classId: string;
  debitCents: bigint;
  creditCents: bigint;
  isBridge: true;
  memo: string;
}

interface EntityNet {
  total: bigint;
  byClass: Map<string | null, bigint>;
}

/** Net debit minus credit per entity and per class, over the non-bridge lines. */
export function entityNets(lines: readonly BridgeInputLine[]): Map<string, EntityNet> {
  const nets = new Map<string, EntityNet>();
  for (const line of lines) {
    if (line.isBridge) continue;
    const net = line.debitCents - line.creditCents;
    let entry = nets.get(line.entityId);
    if (!entry) {
      entry = { total: 0n, byClass: new Map() };
      nets.set(line.entityId, entry);
    }
    entry.total += net;
    entry.byClass.set(line.classId, (entry.byClass.get(line.classId) ?? 0n) + net);
  }
  return nets;
}

export function computeBridgeLines(
  lines: readonly BridgeInputLine[],
  opts: BridgeOptions,
): BridgeLineSpec[] {
  const nets = entityNets(lines);
  const payers = [...nets.entries()].filter(([, n]) => n.total < 0n).map(([id]) => id);
  const receivers = [...nets.entries()].filter(([, n]) => n.total > 0n).map(([id]) => id);
  if (payers.length === 0 && receivers.length === 0) return [];

  const code = (id: string) => opts.entityCodes?.get(id) ?? id;
  const rule = (payer: string, receiver: string) =>
    opts.rules.find((r) => r.payerEntityId === payer && r.receiverEntityId === receiver);
  const out: BridgeLineSpec[] = [];

  for (const payer of payers) {
    const counterpart = receivers.find((r) => rule(payer, r)) ?? receivers[0];
    const accountId =
      (counterpart && rule(payer, counterpart)?.payerAccountId) ?? opts.defaultPayerAccountId;
    const shortfall = -(nets.get(payer) as EntityNet).total;
    out.push({
      entityId: payer,
      accountId,
      classId: opts.generalClassId,
      debitCents: shortfall,
      creditCents: 0n,
      isBridge: true,
      memo: counterpart
        ? `Cross-entity bridge: ${code(payer)} paid for ${code(counterpart)}`
        : `Cross-entity bridge: ${code(payer)} paid`,
    });
  }

  for (const receiver of receivers) {
    const counterpart = payers.find((p) => rule(p, receiver)) ?? payers[0];
    const accountId =
      (counterpart && rule(counterpart, receiver)?.receiverAccountId) ??
      opts.defaultReceiverAccountId;
    const byClass = (nets.get(receiver) as EntityNet).byClass;
    for (const [classId, net] of byClass) {
      if (net === 0n) continue;
      out.push({
        entityId: receiver,
        accountId,
        classId: classId ?? opts.generalClassId,
        debitCents: net < 0n ? -net : 0n,
        creditCents: net > 0n ? net : 0n,
        isBridge: true,
        memo: counterpart
          ? `Cross-entity bridge: ${code(counterpart)} paid for ${code(receiver)}`
          : `Cross-entity bridge: ${code(receiver)} received`,
      });
    }
  }
  return out;
}

/** True when every entity balances on its own (what the database trigger enforces). */
export function balancesPerEntity(
  lines: readonly { entityId: string | null; debitCents: bigint; creditCents: bigint }[],
): boolean {
  const totals = new Map<string | null, bigint>();
  for (const l of lines) {
    totals.set(l.entityId, (totals.get(l.entityId) ?? 0n) + l.debitCents - l.creditCents);
  }
  return [...totals.values()].every((t) => t === 0n);
}
