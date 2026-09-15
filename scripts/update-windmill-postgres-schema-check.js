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
  if (!original.includes("const result = await sql.begin(async (tx) => {")) {
    throw new Error(`Refusing to update ${scriptPath}: expected migration body was not found.`);
  }
  if (original.includes("export async function main(check_only = true)")) {
    console.log(`${scriptPath}: read-only check mode already present`);
    return;
  }

  const content = original
    .replace(
      "export async function main() {",
      "export async function main(check_only = true) {",
    )
    .replace(
      "  const result = await sql.begin(async (tx) => {",
      `  const connection = await sql\`SELECT current_database() AS database_name, current_user AS database_user, inet_server_addr()::text AS server_address, inet_server_port() AS server_port\`
    const existingTables = await sql\`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    \`
    const migrationRecord = await sql\`SELECT name, applied_at FROM _kms_migrations WHERE name = \${MIGRATION_NAME}\`
    if (check_only) {
      return {
        mode: 'read_only',
        connection: connection[0],
        existing_table_count: existingTables.length,
        existing_tables: existingTables.map((row) => row.table_name),
        migration_record_present: migrationRecord.length > 0,
        schema_would_be_applied: migrationRecord.length === 0,
        writes_performed: false,
      }
    }

    const result = await sql.begin(async (tx) => {`,
    );

  const response = await fetch(`${base}/api/w/${encodeURIComponent(workspace)}/scripts/update/${encodeURIComponent(scriptPath)}`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({
      path: scriptPath,
      summary: current.summary || "One-time schema-only PostgreSQL migration for the KMS application",
      description: `${current.description || ""} Supports a default read-only check_only mode; migration writes require an explicit false argument.`,
      content,
      language: current.language || "deno",
      kind: current.kind || "script",
      tag: current.tag || undefined,
      auto_parent: true,
      deployment_message: "Add read-only preflight mode to isolated KMS schema migration",
    }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Could not update ${scriptPath}: HTTP ${response.status} ${text.slice(0, 500)}`);
  console.log(`${scriptPath}: read-only check mode added`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
