/**
 * Shared ledger vocabulary: statuses, kinds, labels and the plain-English wording the UI shows.
 * Values mirror the Prisma enums exactly so the generated client's strings can be passed straight in.
 */

export const TRANSACTION_STATUSES = ["DRAFT", "FLAGGED", "POSTED", "VOIDED"] as const;
export type TransactionStatusKey = (typeof TRANSACTION_STATUSES)[number];

export const TRANSACTION_KINDS = ["BANK", "JOURNAL", "ADJUSTING"] as const;
export type TransactionKindKey = (typeof TRANSACTION_KINDS)[number];

export const TRANSACTION_SOURCES = ["IMPORT", "RECEIPT", "STATEMENT", "MANUAL"] as const;
export type TransactionSourceKey = (typeof TRANSACTION_SOURCES)[number];

export const CLASSIFICATION_SOURCES = ["IMPORT", "VENDOR_HISTORY", "AI", "HUMAN"] as const;
export type ClassificationSourceKey = (typeof CLASSIFICATION_SOURCES)[number];

export const STATUS_LABELS: Record<TransactionStatusKey, string> = {
  DRAFT: "Draft",
  FLAGGED: "Flagged",
  POSTED: "Posted",
  VOIDED: "Voided",
};

export const KIND_LABELS: Record<TransactionKindKey, string> = {
  BANK: "Bank transaction",
  JOURNAL: "Journal entry",
  ADJUSTING: "Adjusting entry",
};

export const SOURCE_LABELS: Record<TransactionSourceKey, string> = {
  IMPORT: "Imported from the workbooks",
  RECEIPT: "From a receipt",
  STATEMENT: "From a bank statement",
  MANUAL: "Entered by hand",
};

export const CLASSIFICATION_LABELS: Record<ClassificationSourceKey, string> = {
  IMPORT: "From the imported books",
  VENDOR_HISTORY: "From this vendor's history",
  AI: "Proposed by the AI",
  HUMAN: "Chosen by a person",
};

/** The statuses that still sit in the review queue. */
export function isUnposted(status: TransactionStatusKey): boolean {
  return status === "DRAFT" || status === "FLAGGED";
}

/** Money is integer cents. In the database layer it is a bigint; on the wire to the browser it is an integer number. */
export type Cents = bigint;
