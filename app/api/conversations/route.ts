import { getSession, getSessionByTitle, getSettingValue, listSessions, saveConversation } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function isConversationHistoryEnabled() {
  return getSettingValue("conversationHistory", "true") !== "false";
}

export function GET(request: Request) {
  const auth = requireRole(request, ["Admin", "User"]);
  if ("response" in auth) return auth.response;
  if (!isConversationHistoryEnabled()) return NextResponse.json({ conversations: [] });
  const params = new URL(request.url).searchParams;
  const id = params.get("id");
  const title = params.get("title");
  const projectParam = params.get("projectId");
  const projectId = projectParam === null ? undefined : projectParam === "unassigned" ? null : Number(projectParam);
  if (typeof projectId === "number" && !Number.isInteger(projectId)) return NextResponse.json({ error: "Invalid project id." }, { status: 400 });
  return NextResponse.json(
    id
      ? getSession(id, auth.user.email) || (title ? getSessionByTitle(title, projectId, auth.user.email) : null)
      : title
        ? getSessionByTitle(title, projectId, auth.user.email)
        : { conversations: listSessions(projectId, auth.user.email) },
  );
}

export async function POST(request: Request) {
  const auth = requireRole(request, ["Admin", "User"]);
  if ("response" in auth) return auth.response;
  const body = (await request.json()) as { id?: string; title?: string; projectId?: number | null; messages?: Array<{ role: "user" | "assistant"; content: string }> };
  if (!body.id || !body.title || !body.messages) return NextResponse.json({ error: "id, title and messages are required" }, { status: 400 });
  if (!isConversationHistoryEnabled()) return NextResponse.json({ ok: true, skipped: "conversation_history_disabled" });
  saveConversation(body.id, body.title, body.messages, body.projectId, auth.user.name, auth.user.email);
  return NextResponse.json({ ok: true });
}
