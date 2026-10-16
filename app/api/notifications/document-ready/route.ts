import { requireRole } from "@/lib/auth";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireRole(request, ["Admin"]);
  if ("response" in auth) return auth.response;
  return NextResponse.json(
    { error: "Document-ready email delivery has been retired. READY events now create portal notifications." },
    { status: 410 },
  );
}
