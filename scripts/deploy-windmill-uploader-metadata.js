/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");

function readEnv(filePath) {
  return Object.fromEntries(
    fs.readFileSync(filePath, "utf8")
      .split(/\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [
          line.slice(0, index),
          line.slice(index + 1).replace(/^"|"$/g, ""),
        ];
      }),
  );
}

function required(value, name) {
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function replaceOnce(content, search, replacement, label) {
  if (!content.includes(search)) {
    if (content.includes(replacement)) return content;
    throw new Error(`Could not find ${label}.`);
  }
  return content.replace(search, replacement);
}

const updates = {
  "f/kms/process_approved_document": (content) => {
    let next = content;
    next = replaceOnce(
      next,
      "      file_size_bytes: input.file_size_bytes,\n    },",
      "      file_size_bytes: input.file_size_bytes,\n      uploaded_by: input.uploaded_by,\n      uploaded_at: input.uploaded_at,\n    },",
      "process request body",
    );
    return next;
  },
  "f/kms/download_approved_document": (content) => {
    let next = content;
    next = replaceOnce(next, "  file_size_bytes?: number\n}", "  file_size_bytes?: number\n  uploaded_by?: string\n  uploaded_at?: string\n}", "download input type");
    next = replaceOnce(
      next,
      "  file_size_bytes?: number,\n) {\n  const input: Input = { dropbox_path, file_name, dropbox_file_id, dropbox_revision, file_size_bytes }",
      "  file_size_bytes?: number,\n  uploaded_by?: string,\n  uploaded_at?: string,\n) {\n  const input: Input = { dropbox_path, file_name, dropbox_file_id, dropbox_revision, file_size_bytes, uploaded_by, uploaded_at }",
      "download signature",
    );
    next = replaceOnce(
      next,
      "    size_bytes: bytes.byteLength,\n    content_base64: btoa(binary),",
      "    size_bytes: bytes.byteLength,\n    uploaded_by: input.uploaded_by ?? null,\n    uploaded_at: input.uploaded_at ?? null,\n    content_base64: btoa(binary),",
      "download return",
    );
    return next;
  },
  "f/kms/extract_document_unstructured": (content) => {
    let next = content;
    next = replaceOnce(next, "  version?: string,\n) {", "  version?: string,\n  uploaded_by?: string,\n  uploaded_at?: string,\n) {", "extract signature");
    next = next.replaceAll(
      "      version: version ?? null,\n      element_count:",
      "      version: version ?? null,\n      owner_name: uploaded_by ?? null,\n      uploaded_by: uploaded_by ?? null,\n      uploaded_at: uploaded_at ?? null,\n      element_count:",
    );
    return next;
  },
  "f/kms/clean_and_chunk_document": (content) => {
    let next = content;
    next = replaceOnce(next, "  version?: string,\n) {", "  version?: string,\n  uploaded_by?: string,\n  uploaded_at?: string,\n) {", "chunk signature");
    next = next.replaceAll(
      "      version: version ?? null,\n    })",
      "      version: version ?? null,\n      owner_name: uploaded_by ?? null,\n      uploaded_by: uploaded_by ?? null,\n      uploaded_at: uploaded_at ?? null,\n    })",
    );
    next = next.replaceAll(
      "department: department ?? null, version: version ?? null })",
      "department: department ?? null, version: version ?? null, owner_name: uploaded_by ?? null, uploaded_by: uploaded_by ?? null, uploaded_at: uploaded_at ?? null })",
    );
    next = replaceOnce(
      next,
      "    department: department ?? null,\n    source_elements:",
      "    department: department ?? null,\n    owner_name: uploaded_by ?? null,\n    uploaded_by: uploaded_by ?? null,\n    uploaded_at: uploaded_at ?? null,\n    source_elements:",
      "chunk return",
    );
    return next;
  },
  "f/kms/embed_document_chunks": (content) => {
    let next = content;
    next = replaceOnce(next, "  version?: string,\n) {", "  version?: string,\n  uploaded_by?: string,\n  uploaded_at?: string,\n) {", "embed signature");
    next = replaceOnce(
      next,
      "    version: version ?? null,\n    chunk_count:",
      "    version: version ?? null,\n    owner_name: uploaded_by ?? null,\n    uploaded_by: uploaded_by ?? null,\n    uploaded_at: uploaded_at ?? null,\n    chunk_count:",
      "embed return",
    );
    return next;
  },
  "f/kms/index_embedded_chunks_qdrant": (content) => {
    let next = content;
    next = replaceOnce(
      next,
      "  content_hash?: string,\n) {",
      "  content_hash?: string,\n  uploaded_by?: string,\n  uploaded_at?: string,\n) {",
      "index signature",
    );
    next = replaceOnce(
      next,
      "        content_hash: content_hash ?? null,\n        page_number:",
      "        content_hash: content_hash ?? null,\n        owner_name: uploaded_by ?? null,\n        uploaded_by: uploaded_by ?? null,\n        uploaded_at: uploaded_at ?? null,\n        page_number:",
      "index payload",
    );
    return next;
  },
  "f/kms/update_document_status": (content) => {
    let next = content;
    next = replaceOnce(
      next,
      "  error_message?: string,\n) {",
      "  error_message?: string,\n  uploaded_by?: string,\n  uploaded_at?: string,\n) {",
      "status signature",
    );
    next = replaceOnce(next, "        error_message TEXT,\n        created_at", "        error_message TEXT,\n        uploaded_by TEXT,\n        uploaded_at TIMESTAMPTZ,\n        created_at", "status table columns");
    next = replaceOnce(
      next,
      "      )\n    `\n\n    const documentKey",
      "      )\n    `\n    await sql`ALTER TABLE kms_document_processing ADD COLUMN IF NOT EXISTS uploaded_by TEXT`\n    await sql`ALTER TABLE kms_document_processing ADD COLUMN IF NOT EXISTS uploaded_at TIMESTAMPTZ`\n\n    const documentKey",
      "status migrations",
    );
    next = replaceOnce(
      next,
      "        department, version, content_hash, status, chunk_count, error_message, ready_at\n      ) VALUES (",
      "        department, version, content_hash, status, chunk_count, error_message, uploaded_by, uploaded_at, ready_at\n      ) VALUES (",
      "status insert columns",
    );
    next = replaceOnce(
      next,
      "        ${department ?? null}, ${version ?? null}, ${content_hash ?? null}, ${status}, ${chunk_count ?? null}, ${error_message ?? null}, ${readyAt}\n      )",
      "        ${department ?? null}, ${version ?? null}, ${content_hash ?? null}, ${status}, ${chunk_count ?? null}, ${error_message ?? null}, ${uploaded_by ?? null}, ${uploaded_at ?? null}, ${readyAt}\n      )",
      "status insert values",
    );
    next = replaceOnce(
      next,
      "        error_message = EXCLUDED.error_message,\n        updated_at = NOW(),",
      "        error_message = EXCLUDED.error_message,\n        uploaded_by = EXCLUDED.uploaded_by,\n        uploaded_at = EXCLUDED.uploaded_at,\n        updated_at = NOW(),",
      "status update values",
    );
    return next;
  },
  "f/kms/retrieve_qdrant_chunks": (content) => {
    let next = content;
    next = replaceOnce(
      next,
      "  const documents = new Map<string, { file_name?: string; dropbox_path?: string; dropbox_file_id?: string }>()",
      "  const documents = new Map<string, { file_name?: string; dropbox_path?: string; dropbox_file_id?: string; owner_name?: string; uploaded_by?: string; uploaded_at?: string }>()",
      "retrieve document type",
    );
    next = replaceOnce(
      next,
      "body: JSON.stringify({ limit: 1000, offset, with_payload: ['file_name', 'dropbox_path', 'department'], filter }),",
      "body: JSON.stringify({ limit: 1000, offset, with_payload: ['file_name', 'dropbox_path', 'dropbox_file_id', 'department', 'owner_name', 'uploaded_by', 'uploaded_at'], filter }),",
      "retrieve scroll payload",
    );
    next = replaceOnce(
      next,
      "documents.set(key, { file_name: payload.file_name, dropbox_path: payload.dropbox_path, dropbox_file_id: payload.dropbox_file_id })",
      "documents.set(key, { file_name: payload.file_name, dropbox_path: payload.dropbox_path, dropbox_file_id: payload.dropbox_file_id, owner_name: payload.owner_name, uploaded_by: payload.uploaded_by, uploaded_at: payload.uploaded_at })",
      "retrieve document map",
    );
    return next;
  },
};

async function main() {
  const env = readEnv(".env");
  const base = required(env.BASE_URL || env.WINDMILL_BASE_URL, "BASE_URL").replace(/\/$/, "");
  const workspace = required(env.WM_WORKSPACE || env.WINDMILL_WORKSPACE, "WM_WORKSPACE");
  const token = required(env.WM_TOKEN || env.WINDMILL_TOKEN, "WM_TOKEN");
  const headers = { authorization: `Bearer ${token}` };

  for (const [scriptPath, updateContent] of Object.entries(updates)) {
    const getUrl = `${base}/api/w/${encodeURIComponent(workspace)}/scripts/get/p/${scriptPath}`;
    const currentResponse = await fetch(getUrl, { headers });
    if (!currentResponse.ok) throw new Error(`Could not read ${scriptPath}: HTTP ${currentResponse.status}`);
    const current = await currentResponse.json();
    const content = updateContent(current.content || "");
    if (content === current.content) {
      console.log(`${scriptPath}: already updated`);
      continue;
    }
    const updateResponse = await fetch(`${base}/api/w/${encodeURIComponent(workspace)}/scripts/update/${encodeURIComponent(scriptPath)}`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        path: scriptPath,
        summary: current.summary || "",
        description: current.description || "",
        content,
        language: current.language || "deno",
        kind: current.kind || "script",
        tag: current.tag || undefined,
        auto_parent: true,
        deployment_message: "Preserve KMS uploader metadata through indexing",
      }),
    });
    const text = await updateResponse.text();
    if (!updateResponse.ok) throw new Error(`Could not update ${scriptPath}: HTTP ${updateResponse.status} ${text.slice(0, 500)}`);
    console.log(`${scriptPath}: update accepted ${updateResponse.status}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
