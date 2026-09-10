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

const scriptPath = "f/kms/delete_document_from_knowledge_base";

const content = [
  "import postgres from 'npm:postgres@3'",
  "import { getVariable } from 'npm:windmill-client@1'",
  "",
  "const variable = (name: string) => getVariable(`f/kms/${name}`)",
  "",
  "function clean(value?: string | null) {",
  "  const next = value?.trim()",
  "  return next && next.length > 0 ? next : null",
  "}",
  "",
  "export async function main(dropbox_path?: string, file_name?: string, dropbox_file_id?: string) {",
  "  const dropboxPath = clean(dropbox_path)",
  "  const fileName = clean(file_name)",
  "  const dropboxFileId = clean(dropbox_file_id)",
  "  if (!dropboxPath && !fileName && !dropboxFileId) {",
  "    throw new Error('dropbox_path, file_name, or dropbox_file_id is required')",
  "  }",
  "",
  "  const qdrantUrl = (await variable('QDRANT_URL')).replace(/\\/$/, '')",
  "  const collection = (await variable('QDRANT_COLLECTION')) || 'kms_documents'",
  "  const apiKey = await variable('QDRANT_API_KEY').catch(() => '')",
  "  if (!qdrantUrl) throw new Error('QDRANT_URL is not configured')",
  "",
  "  const conditions = [",
  "    dropboxPath ? { key: 'dropbox_path', match: { value: dropboxPath } } : null,",
  "    fileName ? { key: 'file_name', match: { value: fileName } } : null,",
  "    dropboxFileId ? { key: 'dropbox_file_id', match: { value: dropboxFileId } } : null,",
  "  ].filter(Boolean)",
  "",
  "  const headers: Record<string, string> = { 'Content-Type': 'application/json' }",
  "  if (apiKey) headers['api-key'] = apiKey",
  "",
  "  const deleteResponse = await fetch(qdrantUrl + '/collections/' + encodeURIComponent(collection) + '/points/delete?wait=true', {",
  "    method: 'POST',",
  "    headers,",
  "    body: JSON.stringify({",
  "      filter: conditions.length === 1 ? { must: conditions } : { should: conditions },",
  "    }),",
  "  })",
  "  if (!deleteResponse.ok) {",
  "    const detail = await deleteResponse.text()",
  "    throw new Error('Qdrant delete failed: HTTP ' + deleteResponse.status + (detail ? ' - ' + detail.slice(0, 500) : ''))",
  "  }",
  "  const deleteResult = await deleteResponse.json()",
  "",
  "  let postgresUpdated = 0",
  "  const databaseUrl = await variable('DATABASE_URL').catch(() => '')",
  "  if (databaseUrl) {",
  "    const sql = postgres(databaseUrl, { max: 1 })",
  "    try {",
  "      const updates = await sql`",
  "        UPDATE kms_document_processing",
  "        SET status = 'DELETED', updated_at = NOW()",
  "        WHERE (${dropboxPath}::text IS NOT NULL AND dropbox_path = ${dropboxPath})",
  "           OR (${fileName}::text IS NOT NULL AND file_name = ${fileName})",
  "           OR (${dropboxFileId}::text IS NOT NULL AND dropbox_file_id = ${dropboxFileId})",
  "      `",
  "      postgresUpdated = updates.count ?? 0",
  "    } finally {",
  "      await sql.end({ timeout: 5 })",
  "    }",
  "  }",
  "",
  "  return {",
  "    deleted: true,",
  "    collection,",
  "    qdrant_status: deleteResult.status ?? 'ok',",
  "    postgres_updated: postgresUpdated,",
  "    dropbox_untouched: true,",
  "  }",
  "}",
].join("\n");

async function saveScript(base, workspace, token, mode) {
  const endpoint = mode === "update"
    ? `${base}/api/w/${encodeURIComponent(workspace)}/scripts/update/${encodeURIComponent(scriptPath)}`
    : `${base}/api/w/${encodeURIComponent(workspace)}/scripts/create`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      path: scriptPath,
      summary: "Remove a KMS document from knowledge retrieval",
      description: "Deletes matching Qdrant points and marks the processing row DELETED. The original Dropbox file is not removed.",
      content,
      language: "deno",
      kind: "script",
      auto_parent: true,
      deployment_message: "Add KMS retrieval-only document deletion",
    }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Could not ${mode} Windmill script: HTTP ${response.status} ${text.slice(0, 500)}`);
  }
  return response.status;
}

async function main() {
  const env = readEnv(".env");
  const base = required(env.BASE_URL || env.WINDMILL_BASE_URL, "BASE_URL").replace(/\/$/, "");
  const workspace = required(env.WM_WORKSPACE || env.WINDMILL_WORKSPACE, "WM_WORKSPACE");
  const token = required(env.WM_TOKEN || env.WINDMILL_TOKEN, "WM_TOKEN");
  const getUrl = `${base}/api/w/${encodeURIComponent(workspace)}/scripts/get/p/${scriptPath}`;
  const currentResponse = await fetch(getUrl, { headers: { authorization: `Bearer ${token}` } });
  const mode = currentResponse.ok ? "update" : "create";
  const status = await saveScript(base, workspace, token, mode);
  console.log(`Windmill delete script ${mode} accepted: ${status}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
