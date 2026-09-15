import { getQueryStats, getSettingValue, saveQueryEvent, saveRetrievalResolution, saveRetrievalReview } from "@/lib/db";
import { requireActiveUser, requireRole } from "@/lib/auth";
import { NextResponse } from "next/server";
export const runtime = "nodejs";
export async function GET(request: Request) { const auth = await requireRole(request, ["Admin"]); if ("response" in auth) return auth.response; return NextResponse.json(await getQueryStats()); }
export async function POST(request: Request) { const auth = await requireActiveUser(request); if ("response" in auth) return auth.response; if (await getSettingValue("conversationHistory", "true") === "false") return NextResponse.json({ ok: true, skipped: "conversation_history_disabled" }); const body = await request.json(); await saveQueryEvent({ ...body, userName: auth.user.name }); return NextResponse.json({ ok: true }); }
export async function PATCH(request: Request) {
  const auth = await requireRole(request, ["Admin"]);
  if ("response" in auth) return auth.response;
  const body = await request.json();
  if (!body.queryEventId) return NextResponse.json({ error: "Query is required." }, { status: 400 });
  if (body.resolution) {
    await saveRetrievalResolution(body);
    return NextResponse.json({ ok: true });
  }
  if (!["relevant", "miss"].includes(body.verdict)) return NextResponse.json({ error: "Verdict is required." }, { status: 400 });
  await saveRetrievalReview(body);
  return NextResponse.json({ ok: true });
}
