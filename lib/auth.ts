import { getUserBySessionToken, type AppRole } from "@/lib/db";
import { NextResponse } from "next/server";

export const AUTH_COOKIE = "beforest_session";

function cookieValue(request: Request, name: string) {
  const cookie = request.headers.get("cookie") || "";
  const match = cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

export async function currentUser(request: Request) {
  return getUserBySessionToken(cookieValue(request, AUTH_COOKIE));
}

export async function requireActiveUser(request: Request) {
  const user = await currentUser(request);
  if (!user) return { response: NextResponse.json({ error: "Please log in." }, { status: 401 }) };
  return { user };
}

export async function requireRole(request: Request, roles: AppRole[]) {
  const result = await requireActiveUser(request);
  if ("response" in result) return result;
  if (!roles.includes(result.user.role)) {
    return { response: NextResponse.json({ error: "You do not have permission for this action." }, { status: 403 }) };
  }
  return result;
}
