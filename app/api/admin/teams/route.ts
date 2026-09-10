import { requireRole } from "@/lib/auth";
import { listNotificationTeams } from "@/lib/db";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export function GET(request: Request) {
  const auth = requireRole(request, ["Admin"]);
  if ("response" in auth) return auth.response;
  return NextResponse.json({ teams: listNotificationTeams() });
}
