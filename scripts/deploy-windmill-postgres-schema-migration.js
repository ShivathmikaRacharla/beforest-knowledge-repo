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
  const schemaSql = fs.readFileSync("scripts/sql/001_initial_schema.postgres.sql", "utf8");
  const content = `import postgres from 'npm:postgres@3'\nimport { getVariable } from 'npm:windmill-client@1'\n\nconst MIGRATION_NAME = '001_initial_schema.postgres.sql'\nconst SCHEMA_SQL = ${JSON.stringify(schemaSql)}\n\nexport async function main() {\n  const databaseUrl = (await getVariable('f/kms/DATABASE_URL')).trim()\n  if (!databaseUrl || /^(file:|sqlite:)/i.test(databaseUrl)) {\n    throw new Error('f/kms/DATABASE_URL must be a PostgreSQL connection string')\n  }\n\n  const sql = postgres(databaseUrl, { max: 1 })\n  try {\n    const result = await sql.begin(async (tx) => {\n      await tx\`CREATE TABLE IF NOT EXISTS _kms_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())\`\n      const applied = await tx\`SELECT 1 FROM _kms_migrations WHERE name = \${MIGRATION_NAME}\`\n      if (applied.length) return { already_applied: true }\n      await tx.unsafe(SCHEMA_SQL)\n      await tx\`INSERT INTO _kms_migrations (name) VALUES (\${MIGRATION_NAME})\`\n      return { already_applied: false }\n    })\n\n    const verification = await sql\`\n      SELECT\n        (SELECT COUNT(*)::int FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('projects', 'app_users', 'chat_sessions', 'chat_messages', 'message_feedback', 'in_app_notifications', 'query_events', 'retrieval_traces', 'documents', 'processing_jobs', 'retrieval_reviews', 'retrieval_resolutions', 'model_configs', 'system_settings', 'auth_sessions', 'notification_teams', 'notification_team_members', 'document_team_mappings', 'document_notification_deliveries')) AS expected_tables,\n        (SELECT COUNT(*)::int FROM pg_indexes WHERE schemaname = 'public' AND indexname IN ('idx_chat_messages_session', 'idx_chat_sessions_updated', 'idx_auth_sessions_token', 'idx_document_team_mappings_team', 'idx_notification_team_members_team', 'idx_notification_deliveries_status')) AS expected_indexes,\n        (SELECT COUNT(*)::int FROM _kms_migrations WHERE name = \${MIGRATION_NAME}) AS migration_records\n    \`\n    return { ...result, ...verification[0], application_data_imported: false, sqlite_untouched: true, windmill_existing_scripts_modified: false }\n  } finally {\n    await sql.end({ timeout: 5 })\n  }\n}\n`;

  const headers = { authorization: `Bearer ${token}` };
  const getUrl = `${base}/api/w/${encodeURIComponent(workspace)}/scripts/get/p/${scriptPath}`;
  const currentResponse = await fetch(getUrl, { headers });
  if (currentResponse.ok) {
    throw new Error(`${scriptPath} already exists; refusing to overwrite it.`);
  }
  if (currentResponse.status !== 404) {
    throw new Error(`Could not verify ${scriptPath}: HTTP ${currentResponse.status}`);
  }

  const response = await fetch(`${base}/api/w/${encodeURIComponent(workspace)}/scripts/create`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({
      path: scriptPath,
      summary: "One-time schema-only PostgreSQL migration for the KMS application",
      description: "Creates KMS PostgreSQL tables, constraints, and indexes only. Reads f/kms/DATABASE_URL. Does not import application data, modify SQLite, or touch Dropbox.",
      content,
      language: "deno",
      kind: "script",
      auto_parent: true,
      deployment_message: "Add isolated one-time KMS PostgreSQL schema migration",
    }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Could not create ${scriptPath}: HTTP ${response.status} ${text.slice(0, 500)}`);
  console.log(`${scriptPath}: created successfully`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
