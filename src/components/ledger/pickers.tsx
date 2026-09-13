"use client";

import type { PickerData } from "@/lib/ledger/query";

/** Native selects styled like <Input>: fast, keyboard-friendly, and they work inside dense grids. */
export const SELECT_CLASS =
  "border-input focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full min-w-0 rounded-md border bg-transparent px-2 py-1 text-sm shadow-xs outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50";

const TYPE_ORDER = ["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"] as const;
const TYPE_LABEL: Record<string, string> = {
  ASSET: "Assets",
  LIABILITY: "Liabilities",
  EQUITY: "Equity",
  INCOME: "Income",
  EXPENSE: "Expenses",
};

export function AccountSelect({
  accounts,
  value,
  onChange,
  id,
  name,
  placeholder = "Pick an account",
  className,
  disabled,
  autoFocus,
  excludeAccountId,
  bankGroupLabel = "Bank accounts",
}: {
  accounts: PickerData["accounts"];
  value: string;
  onChange: (id: string) => void;
  id?: string;
  name?: string;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  /** The bank account's own ledger account, which a simple row must not point at. */
  excludeAccountId?: string | null;
  /** Heading of the bank-accounts group at the bottom of the list. */
  bankGroupLabel?: string;
}) {
  return (
    <select
      id={id}
      name={name}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={className ?? SELECT_CLASS}
      disabled={disabled}
      autoFocus={autoFocus}
    >
      <option value="">{placeholder}</option>
      {TYPE_ORDER.map((type) => {
        const group = accounts.filter(
          (a) => a.type === type && !a.isBank && a.id !== excludeAccountId,
        );
        if (group.length === 0) return null;
        return (
          <optgroup key={type} label={TYPE_LABEL[type]}>
            {group.map((a) => (
              <option key={a.id} value={a.id}>
                {a.number} {a.name}
              </option>
            ))}
          </optgroup>
        );
      })}
      {(() => {
        // Closed bank accounts stay out of the list unless the row already points at one.
        const banks = accounts.filter(
          (a) => a.isBank && a.id !== excludeAccountId && (!a.isClosedBank || a.id === value),
        );
        if (banks.length === 0) return null;
        return (
          <optgroup label={bankGroupLabel}>
            {banks.map((a) => (
              <option key={a.id} value={a.id}>
                {a.number} {a.name} {a.isClosedBank ? "(closed bank account)" : "(bank)"}
              </option>
            ))}
          </optgroup>
        );
      })()}
    </select>
  );
}

export function ClassSelect({
  classes,
  value,
  onChange,
  id,
  name,
  placeholder = "Pick a class",
  className,
  disabled,
  autoFocus,
}: {
  classes: PickerData["classes"];
  value: string;
  onChange: (id: string) => void;
  id?: string;
  name?: string;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const shared = classes.filter((c) => c.isShared);
  const byEntity = new Map<string, PickerData["classes"]>();
  for (const c of classes) {
    if (c.isShared) continue;
    const list = byEntity.get(c.entityCode) ?? [];
    list.push(c);
    byEntity.set(c.entityCode, list);
  }
  return (
    <select
      id={id}
      name={name}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={className ?? SELECT_CLASS}
      disabled={disabled}
      autoFocus={autoFocus}
    >
      <option value="">{placeholder}</option>
      {shared.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name} (shared)
        </option>
      ))}
      {[...byEntity.entries()].map(([code, list]) => (
        <optgroup key={code} label={code}>
          {list.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

export function BankAccountSelect({
  bankAccounts,
  value,
  onChange,
  id,
  className,
  disabled,
}: {
  bankAccounts: PickerData["bankAccounts"];
  value: string;
  onChange: (id: string) => void;
  id?: string;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={className ?? SELECT_CLASS}
      disabled={disabled}
    >
      <option value="">Pick a bank account</option>
      {bankAccounts.map((b) => (
        <option key={b.id} value={b.id}>
          {b.label} · {b.entityCode}
        </option>
      ))}
    </select>
  );
}
