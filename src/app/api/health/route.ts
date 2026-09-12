import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Liveness probe. Deliberately does not touch the database or reveal versions. */
export function GET() {
  return NextResponse.json({ ok: true });
}
