import { currentUser } from "@/lib/auth";
import { ensureDefaultAdmin } from "@/lib/db";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export function GET(request: Request) {
  ensureDefaultAdmin();
  return NextResponse.json({ user: currentUser(request) });
}
