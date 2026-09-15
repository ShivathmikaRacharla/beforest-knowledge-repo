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
  const startMarker = "    if (check_only) {";
  const endMarker = "\n\n    const result = await sql.begin(async (tx) => {";
  const start = original.indexOf(startMarker);
  const end = original.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`Refusing to update ${scriptPath}: read-only branch was not found.`);
  if (original.includes("constraint_type_counts")) {
    console.log(`${scriptPath}: comprehensive verification already present`);
    return;
  }

  const checkBranch = `    if (check_only) {
      const expectedTables = ['projects', 'app_users', 'chat_sessions', 'chat_messages', 'message_feedback', 'in_app_notifications', 'query_events', 'retrieval_traces', 'documents', 'processing_jobs', 'retrieval_reviews', 'retrieval_resolutions', 'model_configs', 'system_settings', 'auth_sessions', 'notification_teams', 'notification_team_members', 'document_team_mappings', 'document_notification_deliveries']
      const expectedIndexes = ['idx_chat_messages_session', 'idx_chat_sessions_updated', 'idx_auth_sessions_token', 'idx_document_team_mappings_team', 'idx_notification_team_members_team', 'idx_notification_deliveries_status']
      const expectedForeignKeys = [
        ['chat_sessions', 'project_id', 'projects', 'id'],
        ['chat_messages', 'session_id', 'chat_sessions', 'id'],
        ['in_app_notifications', 'user_id', 'app_users', 'id'],
        ['in_app_notifications', 'feedback_id', 'message_feedback', 'id'],
        ['retrieval_traces', 'query_event_id', 'query_events', 'id'],
        ['processing_jobs', 'document_id', 'documents', 'id'],
        ['retrieval_reviews', 'query_event_id', 'query_events', 'id'],
        ['retrieval_resolutions', 'query_event_id', 'query_events', 'id'],
        ['auth_sessions', 'user_id', 'app_users', 'id'],
        ['notification_team_members', 'team_id', 'notification_teams', 'id'],
        ['notification_team_members', 'user_id', 'app_users', 'id'],
        ['document_team_mappings', 'team_id', 'notification_teams', 'id'],
        ['document_notification_deliveries', 'team_id', 'notification_teams', 'id'],
        ['document_notification_deliveries', 'user_id', 'app_users', 'id'],
      ]
      const [tableRows, indexRows, constraintRows, foreignKeyRows, extensionRows] = await Promise.all([
        sql\`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'\`,
        sql\`SELECT indexname FROM pg_indexes WHERE schemaname = 'public'\`,
        sql\`SELECT constraint_type, COUNT(*)::int AS count FROM information_schema.table_constraints WHERE constraint_schema = 'public' GROUP BY constraint_type ORDER BY constraint_type\`,
        sql\`SELECT tc.table_name, kcu.column_name, ccu.table_name AS foreign_table_name, ccu.column_name AS foreign_column_name
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu ON tc.constraint_catalog = kcu.constraint_catalog AND tc.constraint_schema = kcu.constraint_schema AND tc.constraint_name = kcu.constraint_name
          JOIN information_schema.constraint_column_usage ccu ON tc.constraint_catalog = ccu.constraint_catalog AND tc.constraint_schema = ccu.constraint_schema AND tc.constraint_name = ccu.constraint_name
          WHERE tc.constraint_schema = 'public' AND tc.constraint_type = 'FOREIGN KEY'\`,
        sql\`SELECT extname FROM pg_extension ORDER BY extname\`,
      ])
      const actualTables = tableRows.map((row) => row.table_name)
      const actualIndexes = indexRows.map((row) => row.indexname)
      const actualForeignKeys = foreignKeyRows.map((row) => [row.table_name, row.column_name, row.foreign_table_name, row.foreign_column_name])
      const missingForeignKeys = expectedForeignKeys.filter((expected) => !actualForeignKeys.some((actual) => expected.every((value, index) => actual[index] === value)))
      const constraintTypeCounts = Object.fromEntries(constraintRows.map((row) => [row.constraint_type, row.count]))
      return {
        mode: 'read_only',
        connection: connection[0],
        expected_table_count: expectedTables.length,
        actual_kms_table_count: expectedTables.filter((name) => actualTables.includes(name)).length,
        missing_tables: expectedTables.filter((name) => !actualTables.includes(name)),
        expected_index_count: expectedIndexes.length,
        actual_expected_index_count: expectedIndexes.filter((name) => actualIndexes.includes(name)).length,
        missing_indexes: expectedIndexes.filter((name) => !actualIndexes.includes(name)),
        constraint_type_counts: constraintTypeCounts,
        expected_primary_key_count: 19,
        expected_unique_constraint_count: 10,
        expected_check_constraint_count: 6,
        expected_foreign_key_count: expectedForeignKeys.length,
        missing_foreign_keys: missingForeignKeys,
        required_extensions: [],
        installed_extensions: extensionRows.map((row) => row.extname),
        missing_extensions: [],
        migration_record_present: migrationTableExists && migrationRecord.length > 0,
        schema_would_be_applied: !(migrationTableExists && migrationRecord.length > 0),
        writes_performed: false,
        verification_passed: expectedTables.every((name) => actualTables.includes(name)) && expectedIndexes.every((name) => actualIndexes.includes(name)) && missingForeignKeys.length === 0 && constraintTypeCounts['PRIMARY KEY'] === 19 && constraintTypeCounts['UNIQUE'] === 10 && constraintTypeCounts['CHECK'] === 6 && constraintTypeCounts['FOREIGN KEY'] === expectedForeignKeys.length,
      }
    }`;
  const content = original.slice(0, start) + checkBranch + original.slice(end);
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
      deployment_message: "Expand read-only KMS PostgreSQL schema verification",
    }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Could not update ${scriptPath}: HTTP ${response.status} ${text.slice(0, 500)}`);
  console.log(`${scriptPath}: comprehensive read-only verification added`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
