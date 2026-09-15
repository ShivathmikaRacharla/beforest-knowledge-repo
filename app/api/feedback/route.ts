import { listFeedback, resolveFeedback, saveFeedback } from "@/lib/db";
import { requireActiveUser, requireRole } from "@/lib/auth";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: Request) { const auth = await requireRole(request, ["Admin"]); if ("response" in auth) return auth.response; return NextResponse.json({ feedback: await listFeedback() }); }
export async function POST(request: Request) {
  const auth = await requireActiveUser(request);
  if ("response" in auth) return auth.response;
  const body = (await request.json()) as { sessionId?: string; rating?: "up" | "down" | "neutral"; note?: string };
  if (!body.sessionId || !body.rating || !["up", "down", "neutral"].includes(body.rating)) return NextResponse.json({ error: "sessionId and rating are required" }, { status: 400 });
  await saveFeedback(body.sessionId, body.rating, body.note);
  return NextResponse.json({ ok: true });
}
export async function PATCH(request: Request) {
  const auth = await requireRole(request, ["Admin"]);
  if ("response" in auth) return auth.response;
  const body = (await request.json()) as { feedbackId?: number; resolutionNote?: string };
  if (!body.feedbackId) return NextResponse.json({ error: "feedbackId is required" }, { status: 400 });
  const result = await resolveFeedback(Number(body.feedbackId), body.resolutionNote);
  if (!result.resolved) return NextResponse.json({ error: "Feedback not found" }, { status: 404 });
  return NextResponse.json({ ok: true, notified: result.notified });
}
