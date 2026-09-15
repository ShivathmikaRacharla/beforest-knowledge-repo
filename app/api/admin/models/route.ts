import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireRole(request, ["Admin"]);
  if ("response" in auth) return auth.response;

  return NextResponse.json(
    {
      error:
        "Model settings are managed by the configured knowledge backend, not this UI.",
    },
    { status: 410 },
  );
}

export async function POST(request: Request) {
  const auth = await requireRole(request, ["Admin"]);
  if ("response" in auth) return auth.response;

  return NextResponse.json(
    {
      error:
        "Model settings are managed by the configured knowledge backend, not this UI.",
    },
    { status: 410 },
  );
}
