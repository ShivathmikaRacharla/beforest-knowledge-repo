import { getQueryStats, saveQueryEvent, saveRetrievalResolution, saveRetrievalReview } from "@/lib/db";
import { requireActiveUser, requireRole } from "@/lib/auth";
import { NextResponse } from "next/server";
export const runtime = "nodejs";
export function GET(request: Request) { const auth = requireRole(request, ["Admin"]); if ("response" in auth) return auth.response; return NextResponse.json(getQueryStats()); }
export async function POST(request: Request) { const auth = requireActiveUser(request); if ("response" in auth) return auth.response; const body = await request.json(); saveQueryEvent(body); return NextResponse.json({ ok: true }); }
export async function PATCH(request: Request) {
  const auth = requireRole(request, ["Admin"]);
  if ("response" in auth) return auth.response;
  const body = await request.json();
  if (!body.queryEventId) return NextResponse.json({ error: "Query is required." }, { status: 400 });
  if (body.resolution) {
    saveRetrievalResolution(body);
    return NextResponse.json({ ok: true });
  }
  if (!["relevant", "miss"].includes(body.verdict)) return NextResponse.json({ error: "Verdict is required." }, { status: 400 });
  saveRetrievalReview(body);
  return NextResponse.json({ ok: true });
}
