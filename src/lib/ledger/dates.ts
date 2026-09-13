import { LedgerError } from "./errors";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** "YYYY-MM-DD" → a Date at UTC midnight (how DATE columns travel through Prisma). */
export function parseCalendarDate(value: string | null | undefined, label = "Date"): Date {
  const s = (value ?? "").trim();
  if (!ISO_DATE.test(s)) throw new LedgerError(`${label} must be a calendar date (YYYY-MM-DD).`);
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s)
    throw new LedgerError(`${label} is not a real date.`);
  const year = d.getUTCFullYear();
  if (year < 2000 || year > 2100) throw new LedgerError(`${label} must be between 2000 and 2100.`);
  return d;
}

export function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
