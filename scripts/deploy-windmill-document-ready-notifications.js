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

async function main() {
  const env = readEnv(".env");
  const base = required(env.BASE_URL || env.WINDMILL_BASE_URL, "BASE_URL").replace(/\/$/, "");
  const workspace = required(env.WM_WORKSPACE || env.WINDMILL_WORKSPACE, "WM_WORKSPACE");
  const token = required(env.WM_TOKEN || env.WINDMILL_TOKEN, "WM_TOKEN");
  const scriptPath = "f/kms/notify_team_document_ready";
  const content = fs.readFileSync("scripts/windmill/notify_team_document_ready.ts", "utf8");
  const headers = { authorization: `Bearer ${token}` };
  const getUrl = `${base}/api/w/${encodeURIComponent(workspace)}/scripts/get/p/${scriptPath}`;
  const currentResponse = await fetch(getUrl, { headers });
  const mode = currentResponse.ok ? "update" : "create";
  const endpoint = mode === "update"
    ? `${base}/api/w/${encodeURIComponent(workspace)}/scripts/update/${encodeURIComponent(scriptPath)}`
    : `${base}/api/w/${encodeURIComponent(workspace)}/scripts/create`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({
      path: scriptPath,
      summary: "Notify active team members when a KMS document becomes ready",
      description: "Matches the ready document collection to an active team, sends one SMTP email per active member, and records delivery status. Dropbox is never modified.",
      content,
      language: "deno",
      kind: "script",
      auto_parent: true,
      deployment_message: "Add isolated team document-ready notifications",
    }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Could not ${mode} Windmill script: HTTP ${response.status} ${text.slice(0, 500)}`);
  console.log(`Windmill document-ready notification script ${mode} accepted: ${response.status}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
