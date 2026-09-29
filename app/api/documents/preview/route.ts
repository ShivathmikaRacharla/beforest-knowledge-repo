import { NextResponse } from "next/server";
import { requireActiveUser } from "@/lib/auth";
import { getDropboxPreviewFile } from "@/lib/dropbox";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const auth = await requireActiveUser(request);
    if ("response" in auth) return auth.response;

    const url = new URL(request.url);
    const dropboxPath = url.searchParams.get("path")?.trim();
    const fileName = url.searchParams.get("name")?.trim();
    if (!dropboxPath) {
      return NextResponse.json({ error: "Document path is required." }, { status: 400 });
    }

    const preview = await getDropboxPreviewFile(dropboxPath, fileName || undefined);
    return new Response(preview.bytes, {
      headers: {
        "Content-Type": preview.contentType,
        "Content-Disposition": "inline",
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (error) {
    console.error("Document preview request failed", error);
    return NextResponse.json({ error: "Unable to open this document right now." }, { status: 503 });
  }
}
