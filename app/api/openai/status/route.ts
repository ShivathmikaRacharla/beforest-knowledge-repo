import { NextResponse } from "next/server";
import { requireActiveUser } from "@/lib/auth";
import { listKnowledgeDocuments } from "@/lib/kms";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const auth = await requireActiveUser(request);
    if ("response" in auth) return auth.response;
    const { documents, documentCount } = await listKnowledgeDocuments();
    return NextResponse.json({
      connected: true,
      name: "Approved knowledge base",
      status: "ready",
      fileCounts: {
        in_progress: 0,
        completed: documentCount || documents.length,
        failed: 0,
        cancelled: 0,
        total: documentCount || documents.length,
      },
    });
  } catch {
    return NextResponse.json(
      {
        connected: false,
        error: "Knowledge backend connection failed.",
      },
      { status: 503 },
    );
  }
}
