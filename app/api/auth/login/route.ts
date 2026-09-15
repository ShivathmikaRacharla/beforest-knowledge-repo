import { AUTH_COOKIE } from "@/lib/auth";
import { loginUser } from "@/lib/db";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json()) as { email?: string; password?: string };
  const email = body.email?.trim();
  const password = body.password || "";
  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }

  const result = await loginUser(email, password);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 401 });

  const response = NextResponse.json({ user: result.user });
  response.cookies.set(AUTH_COOKIE, result.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 14,
  });
  return response;
}
