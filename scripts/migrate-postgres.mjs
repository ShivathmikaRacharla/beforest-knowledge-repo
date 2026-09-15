import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: path.join(process.cwd(), ".env") });
const databaseUrl = process.env.DATABASE_URL || "";
if (!databaseUrl || /^(file:|sqlite:)/i.test(databaseUrl)) {
  throw new Error("DATABASE_URL must be a PostgreSQL connection string.");
}

const migrationDir = path.join(process.cwd(), "scripts", "sql");
const migrationFiles = (await fs.readdir(migrationDir))
  .filter((file) => /^\d+_.*\.postgres\.sql$/.test(file))
  .sort();
if (!migrationFiles.length) throw new Error("No PostgreSQL migrations were found.");

const pool = new pg.Pool({ connectionString: databaseUrl });
try {
  await pool.query("CREATE TABLE IF NOT EXISTS _kms_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  for (const file of migrationFiles) {
    const alreadyApplied = await pool.query("SELECT 1 FROM _kms_migrations WHERE name = $1", [file]);
    if (alreadyApplied.rowCount) continue;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(await fs.readFile(path.join(migrationDir, file), "utf8"));
      await client.query("INSERT INTO _kms_migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
      console.log(`Applied ${file}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  console.log("PostgreSQL schema migration completed.");
} finally {
  await pool.end();
}
