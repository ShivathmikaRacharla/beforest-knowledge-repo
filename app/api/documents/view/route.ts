import { NextResponse } from "next/server";
import { requireActiveUser } from "@/lib/auth";
import { getDropboxDocumentFile } from "@/lib/dropbox";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const auth = requireActiveUser(request);
    if ("response" in auth) return auth.response;

    const url = new URL(request.url);
    const dropboxPath = url.searchParams.get("path")?.trim();
    const fileName = url.searchParams.get("name")?.trim();
    const shouldDownload = url.searchParams.get("download") === "1";
    if (!dropboxPath) {
      return NextResponse.json({ error: "Document path is required." }, { status: 400 });
    }

    const file = await getDropboxDocumentFile(dropboxPath, fileName);
    const name = fileName || dropboxPath.split("/").filter(Boolean).pop() || "document";
    return new Response(file.bytes, {
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `${shouldDownload ? "attachment" : "inline"}; filename="${encodeURIComponent(name)}"; filename*=UTF-8''${encodeURIComponent(name)}`,
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (error) {
    console.error("Document view request failed", error);
    return NextResponse.json(
      { error: "Unable to load this document right now." },
      { status: 503 },
    );
  }
}
