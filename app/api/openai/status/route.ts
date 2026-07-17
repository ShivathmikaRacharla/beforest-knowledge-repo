import { NextResponse } from "next/server";
import { getOpenAI, getVectorStoreId } from "@/lib/openai";
import { requireActiveUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const auth = requireActiveUser(request);
    if ("response" in auth) return auth.response;
    const store = await getOpenAI().vectorStores.retrieve(getVectorStoreId());
    return NextResponse.json({
      connected: true,
      name: store.name,
      status: store.status,
      fileCounts: store.file_counts,
    });
  } catch (error) {
    return NextResponse.json(
      {
        connected: false,
        error:
          error instanceof Error ? error.message : "OpenAI connection failed.",
      },
      { status: 503 },
    );
  }
}
