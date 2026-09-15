import { getSession, getSessionByTitle, getSettingValue, listSessions, saveConversation } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

async function isConversationHistoryEnabled() {
  return await getSettingValue("conversationHistory", "true") !== "false";
}

export async function GET(request: Request) {
  const auth = await requireRole(request, ["Admin", "User"]);
  if ("response" in auth) return auth.response;
  if (!await isConversationHistoryEnabled()) return NextResponse.json({ conversations: [] });
  const params = new URL(request.url).searchParams;
  const id = params.get("id");
  const title = params.get("title");
  const projectParam = params.get("projectId");
  const projectId = projectParam === null ? undefined : projectParam === "unassigned" ? null : Number(projectParam);
  if (typeof projectId === "number" && !Number.isInteger(projectId)) return NextResponse.json({ error: "Invalid project id." }, { status: 400 });
  return NextResponse.json(
    id
      ? await getSession(id, auth.user.email) || (title ? await getSessionByTitle(title, projectId, auth.user.email) : null)
      : title
        ? await getSessionByTitle(title, projectId, auth.user.email)
        : { conversations: await listSessions(projectId, auth.user.email) },
  );
}

export async function POST(request: Request) {
  const auth = await requireRole(request, ["Admin", "User"]);
  if ("response" in auth) return auth.response;
  const body = (await request.json()) as { id?: string; title?: string; projectId?: number | null; messages?: Array<{ role: "user" | "assistant"; content: string }> };
  if (!body.id || !body.title || !body.messages) return NextResponse.json({ error: "id, title and messages are required" }, { status: 400 });
  if (!await isConversationHistoryEnabled()) return NextResponse.json({ ok: true, skipped: "conversation_history_disabled" });
  await saveConversation(body.id, body.title, body.messages, body.projectId, auth.user.name, auth.user.email);
  return NextResponse.json({ ok: true });
}
