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
  const scriptPath = "f/kms/migrate_postgres_schema_once";
  const headers = { authorization: `Bearer ${token}` };
  const getUrl = `${base}/api/w/${encodeURIComponent(workspace)}/scripts/get/p/${scriptPath}`;
  const currentResponse = await fetch(getUrl, { headers });
  if (!currentResponse.ok) throw new Error(`Could not read ${scriptPath}: HTTP ${currentResponse.status}`);
  const current = await currentResponse.json();
  const original = current.content || "";
  const oldLine = "    const migrationRecord = await sql`SELECT name, applied_at FROM _kms_migrations WHERE name = \${MIGRATION_NAME}`";
  const newLines = "    const migrationTableExists = existingTables.some((row) => row.table_name === '_kms_migrations')\n    const migrationRecord = migrationTableExists ? await sql`SELECT name, applied_at FROM _kms_migrations WHERE name = \${MIGRATION_NAME}` : []";
  if (!original.includes(oldLine)) throw new Error(`Refusing to update ${scriptPath}: expected bookkeeping query was not found.`);
  const content = original.replace(oldLine, newLines);
  const response = await fetch(`${base}/api/w/${encodeURIComponent(workspace)}/scripts/update/${encodeURIComponent(scriptPath)}`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({
      path: scriptPath,
      summary: current.summary || "One-time schema-only PostgreSQL migration for the KMS application",
      description: current.description || "",
      content,
      language: current.language || "deno",
      kind: current.kind || "script",
      tag: current.tag || undefined,
      auto_parent: true,
      deployment_message: "Handle missing migration bookkeeping table in read-only preflight",
    }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Could not update ${scriptPath}: HTTP ${response.status} ${text.slice(0, 500)}`);
  console.log(`${scriptPath}: missing bookkeeping table handling added`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
