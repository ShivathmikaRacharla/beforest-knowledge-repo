import { AUTH_COOKIE } from "@/lib/auth";
import { logoutSession } from "@/lib/db";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function sessionCookie(request: Request) {
  const cookie = request.headers.get("cookie") || "";
  const match = cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${AUTH_COOKIE}=`));
  return match ? decodeURIComponent(match.slice(AUTH_COOKIE.length + 1)) : null;
}

export async function POST(request: Request) {
  await logoutSession(sessionCookie(request));
  const response = NextResponse.json({ ok: true });
  response.cookies.set(AUTH_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}
