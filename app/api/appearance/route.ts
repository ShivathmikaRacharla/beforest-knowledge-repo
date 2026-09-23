import { getSettingValue } from "@/lib/db";
import { requireActiveUser } from "@/lib/auth";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireActiveUser(request);
  if ("response" in auth) return auth.response;
  return NextResponse.json({
    appearance: {
      thumbnail: await getSettingValue("appearance.thumbnail", ""),
    },
  });
}
