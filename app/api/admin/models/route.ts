import { getActiveModelConfig, saveModelConfig } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { NextResponse } from "next/server";
export const runtime = "nodejs";
export function GET(request: Request) { const auth = requireRole(request, ["Admin"]); if ("response" in auth) return auth.response; return NextResponse.json({ config: getActiveModelConfig() || null }); }
export async function POST(request: Request) { const auth = requireRole(request, ["Admin"]); if ("response" in auth) return auth.response; const body = await request.json(); if (!body.generationModel || !body.embeddingModel || !body.systemPrompt) return NextResponse.json({ error: "All model and prompt fields are required" }, { status: 400 }); saveModelConfig(body); return NextResponse.json({ ok: true, config: getActiveModelConfig() }); }
