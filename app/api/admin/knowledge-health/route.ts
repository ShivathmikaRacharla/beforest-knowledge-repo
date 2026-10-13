import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { listKnowledgeDocuments, retrieveKnowledge } from "@/lib/kms";
import { matchesApprovedDocument } from "@/lib/knowledge-health";
import { getKnowledgeHealth, getKnowledgeHealthTrace } from "@/lib/knowledge-health-service";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const auth = await requireRole(request, ["Admin"]);
  if ("response" in auth) return auth.response;
  try {
    const url = new URL(request.url);
    const runId = url.searchParams.get("runId");
    const result = runId
      ? await getKnowledgeHealthTrace(runId)
      : await getKnowledgeHealth(url.searchParams.get("refresh") === "1");
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Knowledge health read failed", error);
    return NextResponse.json({ error: "Knowledge processing health is temporarily unavailable." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const auth = await requireRole(request, ["Admin"]);
  if ("response" in auth) return auth.response;
  try {
    const body = await request.json() as { documentId?: string };
    const documentId = body.documentId?.trim();
    if (!documentId) return NextResponse.json({ error: "Document ID is required." }, { status: 400 });
    const { documents } = await listKnowledgeDocuments();
    const document = documents.find((item) => (item.dropbox_path || item.file_name || "").toLowerCase() === documentId.toLowerCase());
    if (!document) return NextResponse.json({ error: "Indexed document not found." }, { status: 404 });
    const title = document.file_name || document.dropbox_path?.split("/").pop();
    if (!title) return NextResponse.json({ error: "Document has no searchable title." }, { status: 400 });
    const retrieval = await retrieveKnowledge(title, { limit: 5 });
    const matchingChunks = (retrieval.matches || []).filter((match) => matchesApprovedDocument(match, document)).length;
    return NextResponse.json({ passed: matchingChunks > 0, matchingChunks, checkedAt: new Date().toISOString() });
  } catch (error) {
    console.error("Knowledge retrieval check failed", error);
    return NextResponse.json({ error: "Retrieval check is temporarily unavailable." }, { status: 503 });
  }
}
