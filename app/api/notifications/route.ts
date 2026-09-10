import { requireActiveUser } from "@/lib/auth";
import { listInAppNotifications } from "@/lib/db";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export function GET(request: Request) {
  const auth = requireActiveUser(request);
  if ("response" in auth) return auth.response;
  return NextResponse.json({ notifications: listInAppNotifications(auth.user.id) });
}
