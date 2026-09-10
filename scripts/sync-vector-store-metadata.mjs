import "dotenv/config";
import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const vectorStoreId = process.env.OPENAI_VECTOR_STORE_ID || process.env.VECTOR_STORE_ID;

function titleSlug(value) {
  return value
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function documentTypeFromName(name) {
  const extension = name.split(".").pop()?.toLowerCase() || "";
  if (["pdf", "doc", "docx", "txt", "md"].includes(extension)) return "document";
  if (["ppt", "pptx"].includes(extension)) return "presentation";
  if (["xls", "xlsx", "csv"].includes(extension)) return "spreadsheet";
  if (["png", "jpg", "jpeg", "webp"].includes(extension)) return "image";
  if (["html", "htm"].includes(extension)) return "html";
  return extension || "document";
}

if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required.");
if (!vectorStoreId) throw new Error("OPENAI_VECTOR_STORE_ID is required.");

const page = await client.vectorStores.files.list(vectorStoreId, { limit: 100 });
let updated = 0;
for (const vectorFile of page.data) {
  let filename = vectorFile.attributes?.original_name;
  if (!filename) {
    try {
      const file = await client.files.retrieve(vectorFile.id);
      filename = file.filename;
    } catch {
      filename = vectorFile.id;
    }
  }

  const existing = vectorFile.attributes || {};
  const attributes = {
    ...existing,
    original_name: String(filename).slice(0, 512),
    title_slug: titleSlug(String(filename)),
    document_type: existing.document_type || documentTypeFromName(String(filename)),
    status: existing.status || "published",
    is_current: existing.is_current ?? true,
    access_group: existing.access_group || "all",
    folder: existing.folder || "Knowledge base",
    folder_id: existing.folder_id || "vector-store-imports",
    department_id: existing.department_id || "general",
    uploaded_by: existing.uploaded_by || "OpenAI vector store",
  };

  try {
    await client.vectorStores.files.update(vectorFile.id, {
      vector_store_id: vectorStoreId,
      attributes,
    });
    updated += 1;
    console.log(`updated ${updated}: ${filename}`);
  } catch (error) {
    console.log(`skipped ${filename}: ${error?.message || "Unable to update metadata"}`);
  }
}

console.log(`Metadata sync complete. Updated ${updated} vector-store files.`);
