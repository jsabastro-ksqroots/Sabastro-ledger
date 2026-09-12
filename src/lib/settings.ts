import type { DbOrTx } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

export const GLOBAL_SCOPE = "GLOBAL";

export const SETTING_KEYS = {
  plaLaunchDate: "pla_launch_date",
  receiptRequiredVendorTypes: "receipt_required_vendor_types",
  ai: "ai",
  numberFormat: "number_format",
} as const;

export async function getSetting<T = unknown>(
  tx: DbOrTx,
  key: string,
  scope = GLOBAL_SCOPE,
): Promise<T | null> {
  const row = await tx.setting.findUnique({ where: { scope_key: { scope, key } } });
  return row ? (row.value as T) : null;
}

export async function setSetting(
  tx: DbOrTx,
  key: string,
  value: unknown,
  updatedById: string | null,
  scope = GLOBAL_SCOPE,
): Promise<void> {
  await tx.setting.upsert({
    where: { scope_key: { scope, key } },
    create: { scope, key, value: value as Prisma.InputJsonValue, updatedById },
    update: { value: value as Prisma.InputJsonValue, updatedById },
  });
}
