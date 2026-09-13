"use server";

import path from "node:path";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import {
  ForbiddenError,
  requestMeta,
  requireUser,
  UnauthenticatedError,
} from "@/lib/auth/current-user";
import { hasFullAccess } from "@/lib/auth/permissions";
import { runImport } from "@/lib/import/run";
import { importSourceDir } from "@/lib/import/status";

/**
 * "Re-run import" from Settings → Data. Owner or Full access only. Safe to press at any time: rows that
 * are already in the ledger are skipped, every number is re-checked, and a dry run changes nothing.
 */

export interface ImportActionState {
  ok?: boolean;
  error?: string;
  message?: string;
  runId?: string;
}

export async function rerunImportAction(
  _prev: ImportActionState,
  formData: FormData,
): Promise<ImportActionState> {
  try {
    const user = await requireUser();
    if (!hasFullAccess(user.role))
      throw new ForbiddenError("Only the Owner or a Full-access user can run the import.");
    const dryRun = formData.get("dryRun") === "1";
    const meta = await requestMeta();
    const outcome = await runImport(db, {
      sourceDir: importSourceDir(),
      dryRun,
      actor: { userId: user.id, sessionId: user.sessionId, ...meta, displayName: user.displayName },
      trigger: "app",
      reportPath: dryRun ? null : path.join(process.cwd(), "docs", "IMPORT_REPORT.md"),
    });
    revalidatePath("/settings/data");
    revalidatePath("/ledger");
    revalidatePath("/tax-years");
    revalidatePath("/dashboard");
    const l = outcome.summary.load;
    const inserted = l.a.inserted + l.b.inserted + l.models.inserted;
    const checks = [
      ...outcome.summary.checks.preA,
      ...outcome.summary.checks.preB,
      ...outcome.summary.checks.models,
      ...outcome.summary.checks.db,
    ];
    const failed = checks.filter((c) => !c.ok && c.critical).length;
    if (outcome.status === "FAILED") {
      return { error: outcome.summary.error ?? "The import stopped.", runId: outcome.runId };
    }
    return {
      ok: true,
      runId: outcome.runId,
      message: dryRun
        ? `Dry run finished: ${inserted === 0 ? "nothing new to import" : `${inserted.toLocaleString("en-US")} rows would be imported`}; ${checks.length - failed} of ${checks.length} checks pass. Nothing was changed.`
        : inserted === 0
          ? `Nothing new to import: every source row is already in the ledger. ${checks.length - failed} of ${checks.length} checks pass.`
          : `Imported ${l.a.inserted.toLocaleString("en-US")} 2019–2024 transactions, ${l.b.inserted} 2025 transactions and ${l.models.inserted} reference models. ${checks.length - failed} of ${checks.length} checks pass.`,
    };
  } catch (err) {
    if (err instanceof ForbiddenError || err instanceof UnauthenticatedError)
      return { error: err.message };
    const message = err instanceof Error ? err.message : String(err);
    return { error: message };
  }
}
