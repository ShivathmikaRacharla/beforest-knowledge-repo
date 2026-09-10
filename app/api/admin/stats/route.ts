import { countRecentlyActiveUsers, db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { NextResponse } from "next/server";
export const runtime = "nodejs";
export function GET(request: Request) {
  const auth = requireRole(request, ["Admin"]);
  if ("response" in auth) return auth.response;
  const sessions = (db.prepare("SELECT COUNT(*) as count FROM chat_sessions").get() as { count: number }).count;
  const activeUsers = countRecentlyActiveUsers(30);
  const queries = (db.prepare("SELECT COUNT(*) as count FROM chat_messages WHERE role='user'").get() as { count: number }).count;
  const positive = (db.prepare("SELECT COUNT(*) as count FROM message_feedback WHERE rating='up'").get() as { count: number }).count;
  const negative = (db.prepare("SELECT COUNT(*) as count FROM message_feedback WHERE rating='down'").get() as { count: number }).count;
  const documents = (db.prepare("SELECT COUNT(*) as count FROM documents WHERE status != 'deleted'").get() as { count: number }).count;
  const needsReview = (db.prepare(`
    SELECT COUNT(*) as count
    FROM query_events q
    WHERE NOT EXISTS (SELECT 1 FROM retrieval_resolutions rr WHERE rr.query_event_id = q.id)
      AND (
        q.chunks = 0
        OR q.top_score IS NULL
        OR q.top_score < 0.35
        OR EXISTS (SELECT 1 FROM message_feedback f WHERE f.session_id = q.session_id AND f.rating = 'down')
      )
  `).get() as { count: number }).count;
  return NextResponse.json({ activeUsers, queries, positive, negative, sessions, documents, needsReview });
}
