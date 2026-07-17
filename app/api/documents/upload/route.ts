import { NextResponse } from "next/server";
import { getOpenAI, getVectorStoreId, publicOpenAIError } from "@/lib/openai";
import { requireActiveUser } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  let uploadedFileId: string | null = null;
  try {
    const auth = requireActiveUser(request);
    if ("response" in auth) return auth.response;
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "A document file is required." },
        { status: 400 },
      );
    }

    const folder = String(form.get("folder") || "Knowledge base").slice(0, 512);
    const uploadedBy = auth.user.name.slice(0, 512);
    const accessGroup = String(form.get("accessGroup") || "all").slice(0, 512);
    const requestedChunkSize = Number(form.get("chunkSize") || 800);
    const requestedOverlap = Number(form.get("chunkOverlap") || 160);
    const chunkSize = Math.min(4096, Math.max(100, Math.round(requestedChunkSize)));
    const chunkOverlap = Math.min(Math.floor(chunkSize / 2), Math.max(0, Math.round(requestedOverlap)));

    const maxMb = Number(process.env.MAX_UPLOAD_SIZE_MB || 50);
    if (file.size > maxMb * 1024 * 1024) {
      return NextResponse.json(
        { error: `File exceeds the ${maxMb} MB upload limit.` },
        { status: 413 },
      );
    }

    const client = getOpenAI();
    const uploadedFile = await client.files.create({ file, purpose: "assistants" });
    uploadedFileId = uploadedFile.id;
    const vectorFile = await client.vectorStores.files.createAndPoll(
      getVectorStoreId(),
      {
        file_id: uploadedFile.id,
        attributes: {
          folder,
          uploaded_by: uploadedBy,
          access_group: accessGroup,
          original_name: file.name,
        },
        chunking_strategy: {
          type: "static",
          static: {
            max_chunk_size_tokens: chunkSize,
            chunk_overlap_tokens: chunkOverlap,
          },
        },
      },
      { pollIntervalMs: 1000 },
    );

    if (vectorFile.status !== "completed") {
      return NextResponse.json(
        {
          error:
            vectorFile.last_error?.message ||
            "OpenAI could not index this document.",
          status: vectorFile.status,
        },
        { status: 422 },
      );
    }

    return NextResponse.json({
      id: vectorFile.id,
      name: file.name,
      size: file.size,
      status: vectorFile.status,
      vectorStoreId: getVectorStoreId(),
      folder,
      uploadedBy,
      accessGroup,
      chunking: { chunkSize, chunkOverlap },
    });
  } catch (error) {
    if (uploadedFileId) {
      try { await getOpenAI().files.delete(uploadedFileId); } catch { /* best-effort orphan cleanup */ }
    }
    const result = publicOpenAIError(error, "Unable to upload the document.");
    return NextResponse.json({ error: result.message }, { status: result.status });
  }
}
