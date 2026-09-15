import { requireActiveUser } from "@/lib/auth";
import { listInAppNotifications } from "@/lib/db";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireActiveUser(request);
  if ("response" in auth) return auth.response;
  return NextResponse.json({ notifications: await listInAppNotifications(auth.user.id) });
}
