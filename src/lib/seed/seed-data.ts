import { readFileSync } from "node:fs";
import path from "node:path";
import { csvToObjects } from "@/lib/csv";
import type { Role } from "@/lib/auth/permissions";

export type AccountTypeKey = "ASSET" | "LIABILITY" | "EQUITY" | "INCOME" | "EXPENSE";
export type ClassKindKey = "GENERAL" | "RENTAL" | "LAND" | "FLIP" | "BUSINESS";

export interface SeedAccount {
  number: string;
  name: string;
  parentGroup: string;
  type: AccountTypeKey;
  subType: string;
  subType2: string;
  source: string;
  note: string;
}

export interface SeedClass {
  name: string;
  entityCode: "SREI" | "PLA";
  isShared: boolean;
  isLegalEntity: boolean;
  legalEntityName: string | null;
  kind: ClassKindKey;
  yearsNote: string;
  note: string;
  isActive: boolean;
  sortOrder: number;
}

export interface SeedEntity {
  code: "SREI" | "PLA";
  name: string;
  legalName: string;
  taxForm: "FORM_1065" | "SCHEDULE_C" | "FORM_1120S";
}

export interface SeedBankAccount {
  entityCode: "SREI" | "PLA";
  accountNumber: string;
  name: string;
  institution: string;
  kind: "CHECKING" | "SAVINGS" | "CASH_APP";
  openedOn: string | null;
  closedOn: string | null;
  isActive: boolean;
}

export interface SeedUser {
  email: string;
  displayName: string;
  password: string;
  role: Role;
}

export const SEED_ENTITIES: SeedEntity[] = [
  {
    code: "SREI",
    name: "Sabastro Real Estate Investments",
    legalName: "Sabastro Real Estate Investments LLC",
    taxForm: "FORM_1065",
  },
  {
    code: "PLA",
    name: "Providence Legacy Advisors",
    legalName: "Providence Legacy Advisors LLC",
    taxForm: "SCHEDULE_C",
  },
];

export const SEED_BANK_ACCOUNTS: SeedBankAccount[] = [
  {
    entityCode: "SREI",
    accountNumber: "1101",
    name: "Real Estate",
    institution: "Bank of America",
    kind: "CHECKING",
    openedOn: null,
    closedOn: null,
    isActive: true,
  },
  {
    entityCode: "SREI",
    accountNumber: "1102",
    name: "Old checking (2019)",
    institution: "Bank of America",
    kind: "CHECKING",
    openedOn: null,
    closedOn: "2019-12-31",
    isActive: false,
  },
  {
    entityCode: "PLA",
    accountNumber: "1103",
    name: "PLA",
    institution: "Bank of America",
    kind: "CHECKING",
    openedOn: "2025-06-02",
    closedOn: null,
    isActive: true,
  },
  {
    entityCode: "SREI",
    accountNumber: "1104",
    name: "Venmo",
    institution: "Venmo",
    kind: "CASH_APP",
    openedOn: null,
    closedOn: null,
    isActive: true,
  },
];

/** Tax years to create at seed time: 2019–2024 filed, 2025 open for SREI; 2025 open for PLA. */
export const SEED_TAX_YEARS: {
  entityCode: "SREI" | "PLA";
  year: number;
  state: "OPEN" | "CLOSED" | "FILED";
}[] = [
  ...[2019, 2020, 2021, 2022, 2023, 2024].map((year) => ({
    entityCode: "SREI" as const,
    year,
    state: "FILED" as const,
  })),
  { entityCode: "SREI", year: 2025, state: "OPEN" },
  { entityCode: "PLA", year: 2025, state: "OPEN" },
];

const TYPE_MAP: Record<string, AccountTypeKey> = {
  Asset: "ASSET",
  Liability: "LIABILITY",
  Equity: "EQUITY",
  Income: "INCOME",
  Expense: "EXPENSE",
};

export function loadSeedAccounts(seedDir = path.join(process.cwd(), "seed")): SeedAccount[] {
  const rows = csvToObjects(readFileSync(path.join(seedDir, "chart_of_accounts.csv"), "utf8"));
  return rows.map((r) => {
    const type = TYPE_MAP[r.type ?? ""];
    if (!type) throw new Error(`Unknown account type "${r.type}" for account ${r.number}`);
    if (!/^\d{4}$/.test(r.number ?? ""))
      throw new Error(`Account number must be 4 digits: "${r.number}"`);
    return {
      number: r.number as string,
      name: r.name ?? "",
      parentGroup: r.parent_group ?? "",
      type,
      subType: r.sub_type ?? "",
      subType2: r.sub_type_2 ?? "",
      source: r.source ?? "",
      note: r.note ?? "",
    };
  });
}

function classKind(name: string): ClassKindKey {
  if (name === "General") return "GENERAL";
  if (name.startsWith("Rentals:")) return "RENTAL";
  if (name.startsWith("Land Development:")) return "LAND";
  if (name.startsWith("Flips:")) return "FLIP";
  return "BUSINESS";
}

export function loadSeedClasses(seedDir = path.join(process.cwd(), "seed")): SeedClass[] {
  const rows = csvToObjects(readFileSync(path.join(seedDir, "classes.csv"), "utf8"));
  return rows.map((r, i) => {
    const name = r.class ?? "";
    const entityCode = (r.entity ?? "").trim();
    if (entityCode !== "SREI" && entityCode !== "PLA")
      throw new Error(`Unknown entity "${entityCode}" for class ${name}`);
    const years = r.years_active ?? "";
    const lastYear = Number(years.split("-").pop());
    const note = r.note ?? "";
    // Classes whose activity ended before 2025 are seeded inactive (the seed notes say so explicitly).
    const isActive =
      !/mark inactive/i.test(note) && !(Number.isFinite(lastYear) && lastYear < 2025);
    return {
      name,
      entityCode,
      isShared: (r.is_shared ?? "").toLowerCase() === "true",
      isLegalEntity: (r.legal_entity ?? "") !== "",
      legalEntityName: (r.legal_entity ?? "") === "" ? null : (r.legal_entity as string),
      kind: classKind(name),
      yearsNote: years,
      note,
      isActive,
      sortOrder: i,
    };
  });
}

export function seedUsersFromEnv(e: NodeJS.ProcessEnv = process.env): SeedUser[] {
  const users: SeedUser[] = [];
  if (e.SEED_OWNER_EMAIL && e.SEED_OWNER_PASSWORD) {
    users.push({
      email: e.SEED_OWNER_EMAIL.toLowerCase(),
      displayName: e.SEED_OWNER_NAME || "Owner",
      password: e.SEED_OWNER_PASSWORD,
      role: "OWNER",
    });
  }
  if (e.SEED_FULL_EMAIL && e.SEED_FULL_PASSWORD) {
    users.push({
      email: e.SEED_FULL_EMAIL.toLowerCase(),
      displayName: e.SEED_FULL_NAME || "Full access user",
      password: e.SEED_FULL_PASSWORD,
      role: "FULL",
    });
  }
  return users;
}
