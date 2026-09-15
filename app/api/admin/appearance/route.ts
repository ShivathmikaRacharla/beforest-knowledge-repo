import { getSettings, saveSettingValue } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { NextResponse } from "next/server";
export const runtime = "nodejs";
export async function GET(request: Request) { const auth = await requireRole(request, ["Admin"]); if ("response" in auth) return auth.response; const values = Object.fromEntries((await getSettings()).filter((item) => item.key.startsWith("appearance.")).map((item) => [item.key.slice(11), item.value])); return NextResponse.json({ appearance: values }); }
export async function POST(request: Request) { const auth = await requireRole(request, ["Admin"]); if ("response" in auth) return auth.response; const body = await request.json(); for (const key of ["sidebar", "accent", "thumbnail"]) if (typeof body[key] === "string") await saveSettingValue(`appearance.${key}`, body[key]); return NextResponse.json({ ok: true }); }
