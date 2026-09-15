import { currentUser } from "@/lib/auth";
import { ensureDefaultAdmin } from "@/lib/db";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  await ensureDefaultAdmin();
  return NextResponse.json({ user: await currentUser(request) });
}
