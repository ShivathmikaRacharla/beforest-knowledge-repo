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

function required(value, name) {
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function replaceOnce(content, search, replacement, label) {
  if (content.includes(replacement)) return content;
  if (!content.includes(search)) throw new Error(`Could not find ${label}; refusing to modify Windmill.`);
  return content.replace(search, replacement);
}

function updateContent(content) {
  let next = content;
  next = replaceOnce(
    next,
    "import { getVariable } from 'npm:windmill-client@1'",
    "import { getVariable, JobService } from 'npm:windmill-client@1'",
    "Windmill import",
  );
  next = replaceOnce(
    next,
    "  uploaded_at?: string,\n) {",
    "  uploaded_at?: string,\n  collection_key?: string,\n) {",
    "update_document_status signature",
  );
  next = replaceOnce(
    next,
    "    return { saved: true, document_key: documentKey, status }",
    `    let notificationJobId: string | null = null
    let notificationTriggerError: string | null = null
    if (status === 'READY') {
      try {
        const workspace = Deno.env.get('WM_WORKSPACE')
        if (!workspace) throw new Error('WM_WORKSPACE is missing')
        const pathSegments = dropbox_path.split('/').filter(Boolean)
        const folderName = pathSegments.length > 1 ? pathSegments[pathSegments.length - 2] : ''
        const collectionKey = (collection_key || department || folderName).trim().toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
        if (!collectionKey) throw new Error('Could not determine collection_key for READY document')
        notificationJobId = await JobService.runScriptByPath({
          workspace,
          path: 'f/kms/notify_team_document_ready',
          requestBody: {
            document_key: documentKey,
            document_name: file_name,
            collection_key: collectionKey,
            document_version: Number(version) || 1,
            uploaded_by: uploaded_by ?? undefined,
            ready_date: readyAt?.toISOString() ?? new Date().toISOString(),
            document_url: (await variable('APP_URL').catch(() => '')) || undefined,
          },
        })
      } catch (error) {
        notificationTriggerError = error instanceof Error ? error.message : 'Notification trigger failed'
      }
    }

    return { saved: true, document_key: documentKey, status, notification_job_id: notificationJobId, notification_trigger_error: notificationTriggerError }`,
    "READY notification trigger",
  );
  return next;
}

async function main() {
  const env = readEnv(".env");
  const base = required(env.BASE_URL || env.WINDMILL_BASE_URL, "BASE_URL").replace(/\/$/, "");
  const workspace = required(env.WM_WORKSPACE || env.WINDMILL_WORKSPACE, "WM_WORKSPACE");
  const token = required(env.WM_TOKEN || env.WINDMILL_TOKEN, "WM_TOKEN");
  const scriptPath = "f/kms/update_document_status";
  const headers = { authorization: `Bearer ${token}` };
  const getUrl = `${base}/api/w/${encodeURIComponent(workspace)}/scripts/get/p/${scriptPath}`;
  const currentResponse = await fetch(getUrl, { headers });
  if (!currentResponse.ok) throw new Error(`Could not read ${scriptPath}: HTTP ${currentResponse.status}`);
  const current = await currentResponse.json();
  const content = updateContent(current.content || "");
  if (content === current.content) {
    console.log(`${scriptPath}: already wired`);
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
      deployment_message: "Trigger team notification after KMS document READY status",
    }),
  });
  const text = await updateResponse.text();
  if (!updateResponse.ok) throw new Error(`Could not update ${scriptPath}: HTTP ${updateResponse.status} ${text.slice(0, 500)}`);
  console.log(`${scriptPath}: notification trigger update accepted: ${updateResponse.status}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
