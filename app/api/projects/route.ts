import { createProject, listProjects } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireRole(request, ["Admin", "User"]);
  if ("response" in auth) return auth.response;
  return NextResponse.json({ projects: await listProjects() });
}

export async function POST(request: Request) {
  const auth = await requireRole(request, ["Admin", "User"]);
  if ("response" in auth) return auth.response;
  const body = (await request.json()) as { name?: string; description?: string };
  const name = body.name?.trim();
  const description = body.description?.trim() || "";

  if (!name) {
    return NextResponse.json({ error: "Project name is required." }, { status: 400 });
  }
  if (name.length > 80) {
    return NextResponse.json({ error: "Project name must be 80 characters or fewer." }, { status: 400 });
  }

  try {
    return NextResponse.json({ project: await createProject({ name, description, createdBy: auth.user.name }) }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE")) {
      return NextResponse.json({ error: "A project with this name already exists." }, { status: 409 });
    }
    return NextResponse.json({ error: "Unable to create the project." }, { status: 500 });
  }
}
