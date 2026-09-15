import { requireRole } from "@/lib/auth";
import { assignUserToTeam, createUser, deleteUser, listUsers, notificationTeamExists, updateUser, type AppRole } from "@/lib/db";
import { sendInviteEmail } from "@/lib/email";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const roles: AppRole[] = ["Admin", "User"];

export async function GET(request: Request) {
  const auth = await requireRole(request, ["Admin"]);
  if ("response" in auth) return auth.response;
  return NextResponse.json({ users: await listUsers() });
}

export async function POST(request: Request) {
  const auth = await requireRole(request, ["Admin"]);
  if ("response" in auth) return auth.response;
  const body = (await request.json()) as { name?: string; email?: string; password?: string; role?: AppRole; teamId?: number; active?: boolean; mustChangePassword?: boolean };
  const name = body.name?.trim();
  const email = body.email?.trim().toLowerCase();
  const password = body.password || "";
  const role = body.role;
  if (!name || !email || !password || !role || !roles.includes(role) || !body.teamId) {
    return NextResponse.json({ error: "Name, email, password, role and team are required." }, { status: 400 });
  }
  if (!await notificationTeamExists(body.teamId)) return NextResponse.json({ error: "Please select an active team." }, { status: 400 });
  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }
  try {
    const user = await createUser({ name, email, password, role, active: body.active !== false, mustChangePassword: body.mustChangePassword });
    await assignUserToTeam(user.id, body.teamId);
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
  const auth = await requireRole(request, ["Admin"]);
  if ("response" in auth) return auth.response;
  const body = (await request.json()) as { id?: number; name?: string; email?: string; password?: string; role?: AppRole; teamId?: number; active?: boolean; mustChangePassword?: boolean };
  if (!body.id) return NextResponse.json({ error: "User id is required." }, { status: 400 });
  if (body.role && !roles.includes(body.role)) return NextResponse.json({ error: "Invalid role." }, { status: 400 });
  if (body.teamId !== undefined && !await notificationTeamExists(body.teamId)) return NextResponse.json({ error: "Please select an active team." }, { status: 400 });
  const user = await updateUser(body.id, body);
  if (!user) return NextResponse.json({ error: "User not found." }, { status: 404 });
  if (body.teamId !== undefined) await assignUserToTeam(body.id, body.teamId);
  return NextResponse.json({ user });
}

export async function DELETE(request: Request) {
  const auth = await requireRole(request, ["Admin"]);
  if ("response" in auth) return auth.response;
  const body = (await request.json()) as { id?: number };
  if (!body.id) return NextResponse.json({ error: "User id is required." }, { status: 400 });
  if (body.id === auth.user.id) return NextResponse.json({ error: "You cannot delete your own account." }, { status: 400 });
  const deleted = await deleteUser(body.id);
  if (!deleted) return NextResponse.json({ error: "User not found." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
