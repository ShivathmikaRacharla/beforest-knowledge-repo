import { NextResponse } from "next/server";
import { requireActiveUser } from "@/lib/auth";
import { getDropboxPreviewLink } from "@/lib/dropbox";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const auth = await requireActiveUser(request);
    if ("response" in auth) return auth.response;

    const body = await request.json() as { dropboxPath?: string; fileName?: string };
    const dropboxPath = body.dropboxPath?.trim();
    if (!dropboxPath) {
      return NextResponse.json({ error: "Document path is required." }, { status: 400 });
    }

    const url = await getDropboxPreviewLink(dropboxPath, body.fileName?.trim());
    return NextResponse.json({ url });
  } catch (error) {
    console.error("Document open request failed", error);
    return NextResponse.json(
      { error: "Unable to open this document right now." },
      { status: 503 },
    );
  }
}
