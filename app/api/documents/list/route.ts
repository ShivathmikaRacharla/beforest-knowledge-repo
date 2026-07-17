import { NextResponse } from "next/server";
import { getOpenAI, getVectorStoreId, publicOpenAIError } from "@/lib/openai";
import { requireActiveUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const auth = requireActiveUser(request);
    if ("response" in auth) return auth.response;
    const client = getOpenAI();
    const storeId = getVectorStoreId();
    const page = await client.vectorStores.files.list(storeId, { limit: 100 });
    const files = await Promise.all(
      page.data.map(async (vectorFile) => {
        const file = await client.files.retrieve(vectorFile.id);
        return {
          id: vectorFile.id,
          name: file.filename,
          bytes: file.bytes,
          createdAt: file.created_at,
          status: vectorFile.status,
          folder: String(vectorFile.attributes?.folder || "Knowledge base"),
          owner: String(vectorFile.attributes?.uploaded_by || "OpenAI vector store"),
          accessGroup: String(vectorFile.attributes?.access_group || "legacy"),
          chunkingStrategy: vectorFile.chunking_strategy,
        };
      }),
    );
    return NextResponse.json({ files });
  } catch (error) {
    const result = publicOpenAIError(error, "Unable to load vector-store documents.");
    return NextResponse.json({ error: result.message }, { status: result.status });
  }
}
