import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { deleteKnowledgeDocument } from "@/lib/kms";

export const runtime = "nodejs";

export async function DELETE(request: Request) {
  try {
    const auth = await requireRole(request, ["Admin"]);
    if ("response" in auth) return auth.response;
    const body = (await request.json()) as {
      dropboxPath?: string;
      fileName?: string;
      dropboxFileId?: string;
    };
    const result = await deleteKnowledgeDocument(body);

    return NextResponse.json({
      deleted: Boolean(result.deleted),
      pointsDeleted: result.points_deleted ?? 0,
      postgresUpdated: result.postgres_updated ?? 0,
    });
  } catch (error) {
    console.error("Document delete request failed", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to remove document from knowledge retrieval.",
      },
      { status: 500 },
    );
  }
}
