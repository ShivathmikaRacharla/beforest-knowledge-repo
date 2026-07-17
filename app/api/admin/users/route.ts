import { requireRole } from "@/lib/auth";
import { createUser, deleteUser, listUsers, updateUser, type AppRole } from "@/lib/db";
import { sendInviteEmail } from "@/lib/email";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const roles: AppRole[] = ["Admin", "User", "Contributor"];

export function GET(request: Request) {
  const auth = requireRole(request, ["Admin"]);
  if ("response" in auth) return auth.response;
  return NextResponse.json({ users: listUsers() });
}

export async function POST(request: Request) {
  const auth = requireRole(request, ["Admin"]);
  if ("response" in auth) return auth.response;
  const body = (await request.json()) as { name?: string; email?: string; password?: string; role?: AppRole; active?: boolean; mustChangePassword?: boolean };
  const name = body.name?.trim();
  const email = body.email?.trim().toLowerCase();
  const password = body.password || "";
  const role = body.role;
  if (!name || !email || !password || !role || !roles.includes(role)) {
    return NextResponse.json({ error: "Name, email, password and role are required." }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }
  try {
    const user = createUser({ name, email, password, role, active: body.active !== false, mustChangePassword: body.mustChangePassword });
    let emailResult: { sent: boolean; error?: string };
    try {
      emailResult = await sendInviteEmail({ to: email, name, email, password, role });
    } catch (error) {
      emailResult = {
        sent: false,
        error: error instanceof Error ? error.message : "Invite email failed.",
      };
    }
    return NextResponse.json({ user, inviteEmail: emailResult }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE")) {
      return NextResponse.json({ error: "A user with this email already exists." }, { status: 409 });
    }
    return NextResponse.json({ error: "Unable to create user." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const auth = requireRole(request, ["Admin"]);
  if ("response" in auth) return auth.response;
  const body = (await request.json()) as { id?: number; name?: string; email?: string; password?: string; role?: AppRole; active?: boolean; mustChangePassword?: boolean };
  if (!body.id) return NextResponse.json({ error: "User id is required." }, { status: 400 });
  if (body.role && !roles.includes(body.role)) return NextResponse.json({ error: "Invalid role." }, { status: 400 });
  const user = updateUser(body.id, body);
  if (!user) return NextResponse.json({ error: "User not found." }, { status: 404 });
  return NextResponse.json({ user });
}

export async function DELETE(request: Request) {
  const auth = requireRole(request, ["Admin"]);
  if ("response" in auth) return auth.response;
  const body = (await request.json()) as { id?: number };
  if (!body.id) return NextResponse.json({ error: "User id is required." }, { status: 400 });
  if (body.id === auth.user.id) return NextResponse.json({ error: "You cannot delete your own account." }, { status: 400 });
  const deleted = deleteUser(body.id);
  if (!deleted) return NextResponse.json({ error: "User not found." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
