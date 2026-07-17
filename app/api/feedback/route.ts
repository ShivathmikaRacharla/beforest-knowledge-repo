import { listFeedback, saveFeedback } from "@/lib/db";
import { requireActiveUser, requireRole } from "@/lib/auth";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export function GET(request: Request) { const auth = requireRole(request, ["Admin"]); if ("response" in auth) return auth.response; return NextResponse.json({ feedback: listFeedback() }); }
export async function POST(request: Request) {
  const auth = requireActiveUser(request);
  if ("response" in auth) return auth.response;
  const body = (await request.json()) as { sessionId?: string; rating?: "up" | "down" };
  if (!body.sessionId || !body.rating || !["up", "down"].includes(body.rating)) return NextResponse.json({ error: "sessionId and rating are required" }, { status: 400 });
  saveFeedback(body.sessionId, body.rating);
  return NextResponse.json({ ok: true });
}
