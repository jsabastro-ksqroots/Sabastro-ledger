import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import {
  ForbiddenError,
  requestMeta,
  requirePermission,
  UnauthenticatedError,
} from "@/lib/auth/current-user";
import {
  ACTIVITY_EXPORT_MAX_ROWS,
  auditCsvHeader,
  auditRowToCsv,
  buildAuditWhere,
  describeFilters,
  iterateAuditLog,
  parseActivityParams,
} from "@/lib/activity";

export const dynamic = "force-dynamic";

/**
 * GET /api/activity/export?<same filters as /settings/activity>
 * Streams the filtered audit log as CSV, newest first, at most ACTIVITY_EXPORT_MAX_ROWS rows.
 * The before/after JSON is deliberately left out (only a field count is included) so the file
 * opens cleanly in a spreadsheet; the full detail is always one click away on the Activity tab.
 */
export async function GET(req: NextRequest) {
  let user;
  try {
    user = await requirePermission("VIEW_SETTINGS");
  } catch (err) {
    if (err instanceof UnauthenticatedError)
      return NextResponse.json({ error: "Please sign in." }, { status: 401 });
    if (err instanceof ForbiddenError)
      return NextResponse.json(
        { error: "You do not have permission to view the activity log." },
        { status: 403 },
      );
    throw err;
  }

  const { filters } = parseActivityParams(req.nextUrl.searchParams);
  const meta = await requestMeta();
  const total = await db.auditLog.count({ where: buildAuditWhere(filters) });
  const exported = Math.min(total, ACTIVITY_EXPORT_MAX_ROWS);

  // The export itself is an auditable event, like every other export in the app.
  await db.$transaction(async (tx) => {
    await audit(tx, {
      action: "activity.export",
      userId: user.id,
      sessionId: user.sessionId,
      subjectType: "audit_log",
      subjectLabel: `Activity export (${describeFilters(filters)})`,
      entityId: filters.entityId ?? null,
      after: {
        filters,
        matchingRows: total,
        exportedRows: exported,
        capped: total > ACTIVITY_EXPORT_MAX_ROWS,
      },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(auditCsvHeader()));
        for await (const batch of iterateAuditLog(db, filters, {
          max: ACTIVITY_EXPORT_MAX_ROWS,
          batch: 500,
        })) {
          controller.enqueue(encoder.encode(batch.map(auditRowToCsv).join("")));
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="activity-log-${stamp}.csv"`,
      "Cache-Control": "no-store",
      "X-Total-Rows": String(total),
      "X-Exported-Rows": String(exported),
    },
  });
}
