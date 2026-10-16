import { requireActiveUser } from "@/lib/auth";
import { listInAppNotifications, markDocumentNotificationsRead } from "@/lib/db";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireActiveUser(request);
  if ("response" in auth) return auth.response;
  return NextResponse.json({ notifications: await listInAppNotifications(auth.user.id) });
}

export async function POST(request: Request) {
  const auth = await requireActiveUser(request);
  if ("response" in auth) return auth.response;
  const body = await request.json().catch(() => null) as { ids?: unknown } | null;
  if (!Array.isArray(body?.ids) || body.ids.length > 1000 || !body.ids.every((id) => Number.isSafeInteger(id) && id > 0)) {
    return NextResponse.json({ error: "A list of notification IDs is required." }, { status: 400 });
  }
  const updated = await markDocumentNotificationsRead(auth.user.id, body.ids);
  return NextResponse.json({ updated });
}
