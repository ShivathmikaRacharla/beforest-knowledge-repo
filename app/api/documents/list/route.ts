import { NextResponse } from "next/server";
import { requireActiveUser } from "@/lib/auth";
import { documentType, listKnowledgeDocuments, spaceFromDropboxPath } from "@/lib/kms";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const auth = requireActiveUser(request);
    if ("response" in auth) return auth.response;
    const { documents } = await listKnowledgeDocuments();
    const now = Math.floor(Date.now() / 1000);
    const files = documents.map((document, index) => {
      const name = document.file_name || document.dropbox_path?.split("/").filter(Boolean).pop() || "Untitled document";
      const owner = document.owner_name || document.uploaded_by || document.uploader || document.created_by || "Beforest team";
      return {
        id: document.dropbox_path || document.file_name || `approved-document-${index + 1}`,
        documentId: document.dropbox_path || document.file_name || "",
        dropboxPath: document.dropbox_path || "",
        dropboxFileId: document.dropbox_file_id || "",
        name,
        bytes: 0,
        createdAt: now,
        status: "completed",
        folder: spaceFromDropboxPath(document.dropbox_path),
        owner,
        accessGroup: "all",
        departmentId: "general",
        folderId: "approved-documents",
        documentType: documentType(name),
        publishedStatus: "published",
        version: 1,
        isCurrent: true,
      };
    });
    return NextResponse.json({ files });
  } catch (error) {
    console.error("Document list request failed", error);
    return NextResponse.json(
      {
        error:
          "Approved documents are unavailable because the indexed document service cannot be reached.",
      },
      { status: 503 },
    );
  }
}
