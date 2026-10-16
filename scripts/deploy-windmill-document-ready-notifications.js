/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");

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
  if (!currentResponse.ok) throw new Error(`Could not read existing Windmill script: HTTP ${currentResponse.status}`);
  const current = await currentResponse.json();
  if (process.argv.includes("--snapshot-live")) {
    fs.writeFileSync("tmp/codex-live-notify-20261016.txt", current.content || "");
    console.log("Saved live script source to tmp/codex-live-notify-20261016.txt for comparison");
    return;
  }
  const normalize = (value) => value.replace(/\r\n/g, "\n").trimEnd();
  if (normalize(current.content || "") === normalize(content)) {
    console.log(`${scriptPath}: portal notification script already deployed`);
    return;
  }
  const previous = execFileSync("git", ["show", "HEAD:scripts/windmill/notify_team_document_ready.ts"], { encoding: "utf8" });
  const knownLiveVariant = previous
    .replace("        const safeDocumentUrl = escapeHtml(documentUrl)\n", "")
    .replace("            `Open document: ${documentUrl}`,\n", "")
    .replace('<p><a href="${safeDocumentUrl}">Open document</a></p>', "");
  if (![previous, knownLiveVariant].some((candidate) => normalize(current.content || "") === normalize(candidate))) {
    throw new Error("Live Windmill script differs from the reviewed prior version; refusing to overwrite it.");
  }
  if (!process.argv.includes("--deploy")) {
    console.log(`${scriptPath}: live source matches the reviewed email version; ready to deploy the portal notification replacement`);
    return;
  }
  const endpoint = `${base}/api/w/${encodeURIComponent(workspace)}/scripts/update/${encodeURIComponent(scriptPath)}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({
      path: scriptPath,
      summary: current.summary || "Notify active team members when a KMS document becomes ready",
      description: "Matches a ready document to its active team and records a portal notification for each active member. Dropbox is never modified.",
      content,
      language: current.language || "deno",
      kind: current.kind || "script",
      tag: current.tag || undefined,
      auto_parent: true,
      deployment_message: "Replace document-ready emails with team portal notifications",
    }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Could not update Windmill script: HTTP ${response.status} ${text.slice(0, 500)}`);
  const verifyResponse = await fetch(getUrl, { headers });
  if (!verifyResponse.ok) throw new Error(`Updated Windmill script, but could not verify it: HTTP ${verifyResponse.status}`);
  const verified = await verifyResponse.json();
  if (normalize(verified.content || "") !== normalize(content)) throw new Error("Updated Windmill script, but live content differs from the intended portal notification script.");
  console.log(`Windmill document-ready notification script updated and verified: ${response.status}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
