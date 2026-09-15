import { NextResponse } from "next/server";
import { requireActiveUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireActiveUser(request);
  if ("response" in auth) return auth.response;

  return NextResponse.json(
    {
      error:
        "Document uploads are handled by the approved document pipeline outside this app.",
    },
    { status: 410 },
  );
}
