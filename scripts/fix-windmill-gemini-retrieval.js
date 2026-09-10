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
        return [line.slice(0, index), line.slice(index + 1).replace(/^"|"$/g, "")];
      }),
  );
}

async function main() {
  const env = readEnv(".env");
  const base = (env.BASE_URL || env.WINDMILL_BASE_URL || "").replace(/\/$/, "");
  const workspace = env.WM_WORKSPACE || env.WINDMILL_WORKSPACE;
  const token = env.WM_TOKEN || env.WINDMILL_TOKEN;
  if (!base || !workspace || !token) throw new Error("Windmill connection variables are missing");

  const scriptPath = "f/kms/retrieve_qdrant_chunks";
  const headers = { authorization: `Bearer ${token}` };
  const getResponse = await fetch(`${base}/api/w/${encodeURIComponent(workspace)}/scripts/get/p/${scriptPath}`, { headers });
  if (!getResponse.ok) throw new Error(`Could not read Windmill script: HTTP ${getResponse.status}`);
  const current = await getResponse.json();
  let content = current.content || "";

  const oldBody = "body: JSON.stringify({ model: `models/${model}`, content: { parts: [{ text: question }] }, taskType: 'RETRIEVAL_QUERY' }),";
  const newBody = "body: JSON.stringify({ model: `models/${model}`, content: { parts: [{ text: question }] }, embedContentConfig: { taskType: 'RETRIEVAL_QUERY' } }),";
  const oldModelNormalization = "const configuredModel = (await variable('GEMINI_EMBEDDING_MODEL')) || 'gemini-embedding-001'\n  const model = configuredModel.startsWith('models/') ? configuredModel.slice('models/'.length) : configuredModel";
  const newModelNormalization = "const configuredModel = String((await variable('GEMINI_EMBEDDING_MODEL')) || 'gemini-embedding-001').trim().replace(/^['\"]|['\"]$/g, '')\n  const model = configuredModel.replace(/^models\\//, '').split(':')[0].split('/').pop() || 'gemini-embedding-001'";
  const oldError = "if (!embeddingResponse.ok) throw new Error(`Gemini query embedding failed: HTTP ${embeddingResponse.status}`)";
  const newError = "if (!embeddingResponse.ok) {\n    const detail = await embeddingResponse.text()\n    throw new Error(`Gemini query embedding failed: HTTP ${embeddingResponse.status}${detail ? ` - ${detail.slice(0, 800)}` : ''}`)\n  }";

  if (!content.includes(oldBody) && !content.includes("embedContentConfig: { taskType: 'RETRIEVAL_QUERY' }")) {
    throw new Error("Expected Gemini embedding request was not found; no changes were made.");
  }
  content = content.replace(oldModelNormalization, newModelNormalization).replace(oldBody, newBody).replace(oldError, newError);
  if (content === current.content) {
    console.log("Windmill retrieval script already contains the safe Gemini request update.");
    return;
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
      deployment_message: "Use current Gemini embedding request configuration and preserve provider error detail",
    }),
  });
  const text = await updateResponse.text();
  if (!updateResponse.ok) throw new Error(`Could not update Windmill script: HTTP ${updateResponse.status} ${text.slice(0, 500)}`);
  console.log(`Windmill retrieval update accepted: ${updateResponse.status}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
