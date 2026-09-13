import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ForbiddenError, requirePermission, UnauthenticatedError } from "@/lib/auth/current-user";
import { importRunReport } from "@/lib/import/status";

/** Downloads an import report as Markdown (?run=<id>, else the newest real run). Needs "View settings", like the page. */
export async function GET(request: Request) {
  try {
    await requirePermission("VIEW_SETTINGS");
  } catch (err) {
    if (err instanceof UnauthenticatedError)
      return new NextResponse("Please sign in.", { status: 401 });
    if (err instanceof ForbiddenError)
      return new NextResponse("Viewing settings is not part of your permissions.", { status: 403 });
    throw err;
  }
  const url = new URL(request.url);
  const report = await importRunReport(db, url.searchParams.get("run"));
  if (!report) return new NextResponse("No import report here.", { status: 404 });
  const stamp = report.startedAt.toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return new NextResponse(report.markdown, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="IMPORT_REPORT-${stamp}.md"`,
      "Cache-Control": "no-store",
    },
  });
}
