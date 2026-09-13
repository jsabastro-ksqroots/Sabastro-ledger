import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentSession } from "@/lib/auth/current-user";
import { importRunReport } from "@/lib/import/status";

/** Downloads an import report as Markdown (the latest, or ?run=<id>). Signed-in users only. */
export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session || !session.session.mfaVerifiedAt)
    return new NextResponse("Please sign in.", { status: 401 });
  const url = new URL(request.url);
  const report = await importRunReport(db, url.searchParams.get("run"));
  if (!report) return new NextResponse("No import report yet.", { status: 404 });
  const stamp = report.startedAt.toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return new NextResponse(report.markdown, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="IMPORT_REPORT-${stamp}.md"`,
    },
  });
}
