import { getSettings, saveSetting, saveSettingValue } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { NextResponse } from "next/server";
export const runtime = "nodejs";
export async function GET(request: Request) { const auth = await requireRole(request, ["Admin"]); if ("response" in auth) return auth.response; return NextResponse.json({ settings: await getSettings() }); }
export async function POST(request: Request) {
  const auth = await requireRole(request, ["Admin"]);
  if ("response" in auth) return auth.response;
  const body = await request.json();
  if (!body.key || body.value === undefined) return NextResponse.json({ error: "key and value are required" }, { status: 400 });
  if (typeof body.value === "boolean") await saveSetting(body.key, body.value);
  else await saveSettingValue(body.key, String(body.value));
  return NextResponse.json({ ok: true });
}
