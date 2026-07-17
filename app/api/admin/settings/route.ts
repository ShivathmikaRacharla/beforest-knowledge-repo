import { getSettings, saveSetting } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { NextResponse } from "next/server";
export const runtime = "nodejs";
export function GET(request: Request) { const auth = requireRole(request, ["Admin"]); if ("response" in auth) return auth.response; return NextResponse.json({ settings: getSettings() }); }
export async function POST(request: Request) { const auth = requireRole(request, ["Admin"]); if ("response" in auth) return auth.response; const body = await request.json(); if (!body.key || typeof body.value !== "boolean") return NextResponse.json({ error: "key and boolean value are required" }, { status: 400 }); saveSetting(body.key, body.value); return NextResponse.json({ ok: true }); }
