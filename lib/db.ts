import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const configured = process.env.DATABASE_URL || "file:./data/beforest.db";
const relative = configured.startsWith("file:") ? configured.slice(5) : "./data/beforest.db";
const databasePath = path.isAbsolute(relative) ? relative : path.join(process.cwd(), relative);
fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const globalForDb = globalThis as unknown as { beforestDb?: Database.Database };
export const db = globalForDb.beforestDb ?? new Database(databasePath);
globalForDb.beforestDb = db;
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS chat_sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    user_name TEXT NOT NULL DEFAULT 'Seshu',
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user','assistant')),
    content TEXT NOT NULL,
    metadata TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS message_feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    rating TEXT NOT NULL CHECK (rating IN ('up','down')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS query_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    query TEXT NOT NULL,
    model TEXT,
    latency_ms INTEGER,
    chunks INTEGER NOT NULL DEFAULT 0,
    top_score REAL,
    sources TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS retrieval_reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    query_event_id INTEGER NOT NULL UNIQUE REFERENCES query_events(id) ON DELETE CASCADE,
    expected_source TEXT,
    verdict TEXT NOT NULL CHECK (verdict IN ('relevant','miss')),
    notes TEXT,
    reviewed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS retrieval_resolutions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    query_event_id INTEGER NOT NULL UNIQUE REFERENCES query_events(id) ON DELETE CASCADE,
    resolution TEXT NOT NULL,
    notes TEXT,
    closed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS model_configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    generation_model TEXT NOT NULL,
    embedding_model TEXT NOT NULL,
    system_prompt TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS system_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL DEFAULT 'Seshu',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS app_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('Admin','User','Contributor')),
    active INTEGER NOT NULL DEFAULT 1,
    must_change_password INTEGER NOT NULL DEFAULT 0,
    last_active_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS auth_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id, id);
  CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated ON chat_sessions(updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_auth_sessions_token ON auth_sessions(token_hash);
`);
db.prepare("INSERT OR IGNORE INTO projects (name, description) VALUES (?, ?)").run("Beforest knowledge", "Shared Beforest knowledge base");
try { db.exec("ALTER TABLE chat_messages ADD COLUMN metadata TEXT"); } catch { /* existing database already migrated */ }
try { db.exec("ALTER TABLE chat_sessions ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL"); } catch { /* existing database already migrated */ }
try { db.exec("ALTER TABLE query_events ADD COLUMN top_score REAL"); } catch { /* existing database already migrated */ }
try { db.exec("ALTER TABLE query_events ADD COLUMN sources TEXT"); } catch { /* existing database already migrated */ }

export type AppRole = "Admin" | "User" | "Contributor";
export type AppUser = {
  id: number;
  name: string;
  email: string;
  role: AppRole;
  active: boolean;
  mustChangePassword: boolean;
  lastActiveAt?: string | null;
  createdAt: string;
};

function hashPassword(password: string, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(password, salt, 210000, 32, "sha256").toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, storedHash: string) {
  const [salt, hash] = storedHash.split(":");
  if (!salt || !hash) return false;
  const candidate = hashPassword(password, salt).split(":")[1];
  return crypto.timingSafeEqual(Buffer.from(candidate, "hex"), Buffer.from(hash, "hex"));
}

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function mapUser(row: Record<string, unknown>): AppUser {
  return {
    id: Number(row.id),
    name: String(row.name),
    email: String(row.email),
    role: row.role as AppRole,
    active: Boolean(row.active),
    mustChangePassword: Boolean(row.mustChangePassword ?? row.must_change_password),
    lastActiveAt: row.lastActiveAt ? String(row.lastActiveAt) : null,
    createdAt: String(row.createdAt ?? row.created_at),
  };
}

export function ensureDefaultAdmin() {
  const count = (db.prepare("SELECT COUNT(*) as count FROM app_users").get() as { count: number }).count;
  if (count > 0) return;
  if (!process.env.DEFAULT_ADMIN_EMAIL || !process.env.DEFAULT_ADMIN_PASSWORD) {
    throw new Error("DEFAULT_ADMIN_EMAIL and DEFAULT_ADMIN_PASSWORD are required to seed the first admin user.");
  }
  createUser({
    name: process.env.DEFAULT_ADMIN_NAME || "Seshu",
    email: process.env.DEFAULT_ADMIN_EMAIL,
    password: process.env.DEFAULT_ADMIN_PASSWORD,
    role: "Admin",
    active: true,
  });
}

export function listUsers() {
  ensureDefaultAdmin();
  return (db.prepare("SELECT id, name, email, role, active, must_change_password as mustChangePassword, last_active_at as lastActiveAt, created_at as createdAt FROM app_users ORDER BY id").all() as Array<Record<string, unknown>>).map(mapUser);
}

export function createUser(user: { name: string; email: string; password: string; role: AppRole; active?: boolean; mustChangePassword?: boolean }) {
  const result = db.prepare("INSERT INTO app_users (name, email, password_hash, role, active, must_change_password) VALUES (?, ?, ?, ?, ?, ?)").run(
    user.name,
    user.email.toLowerCase(),
    hashPassword(user.password),
    user.role,
    user.active === false ? 0 : 1,
    user.mustChangePassword ? 1 : 0,
  );
  return mapUser(db.prepare("SELECT id, name, email, role, active, must_change_password as mustChangePassword, last_active_at as lastActiveAt, created_at as createdAt FROM app_users WHERE id = ?").get(result.lastInsertRowid) as Record<string, unknown>);
}

export function updateUser(id: number, updates: Partial<{ name: string; email: string; password: string; role: AppRole; active: boolean; mustChangePassword: boolean }>) {
  const existing = db.prepare("SELECT id FROM app_users WHERE id = ?").get(id);
  if (!existing) return null;
  if (updates.name !== undefined) db.prepare("UPDATE app_users SET name = ? WHERE id = ?").run(updates.name, id);
  if (updates.email !== undefined) db.prepare("UPDATE app_users SET email = ? WHERE id = ?").run(updates.email.toLowerCase(), id);
  if (updates.password !== undefined) db.prepare("UPDATE app_users SET password_hash = ? WHERE id = ?").run(hashPassword(updates.password), id);
  if (updates.role !== undefined) db.prepare("UPDATE app_users SET role = ? WHERE id = ?").run(updates.role, id);
  if (updates.active !== undefined) db.prepare("UPDATE app_users SET active = ? WHERE id = ?").run(updates.active ? 1 : 0, id);
  if (updates.mustChangePassword !== undefined) db.prepare("UPDATE app_users SET must_change_password = ? WHERE id = ?").run(updates.mustChangePassword ? 1 : 0, id);
  if (updates.active === false) db.prepare("DELETE FROM auth_sessions WHERE user_id = ?").run(id);
  return mapUser(db.prepare("SELECT id, name, email, role, active, must_change_password as mustChangePassword, last_active_at as lastActiveAt, created_at as createdAt FROM app_users WHERE id = ?").get(id) as Record<string, unknown>);
}

export function deleteUser(id: number) {
  const existing = db.prepare("SELECT id FROM app_users WHERE id = ?").get(id);
  if (!existing) return false;
  db.prepare("DELETE FROM auth_sessions WHERE user_id = ?").run(id);
  db.prepare("DELETE FROM app_users WHERE id = ?").run(id);
  return true;
}

export function loginUser(email: string, password: string) {
  ensureDefaultAdmin();
  const row = db.prepare("SELECT id, name, email, password_hash as passwordHash, role, active, must_change_password as mustChangePassword, last_active_at as lastActiveAt, created_at as createdAt FROM app_users WHERE lower(email) = lower(?)").get(email) as (Record<string, unknown> & { passwordHash: string }) | undefined;
  if (!row || !verifyPassword(password, row.passwordHash)) return { error: "Invalid email or password." };
  if (!row.active) return { error: "Your account is inactive. Please contact admin." };
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString();
  db.prepare("INSERT INTO auth_sessions (user_id, token_hash, expires_at) VALUES (?, ?, ?)").run(row.id, hashToken(token), expiresAt);
  db.prepare("UPDATE app_users SET last_active_at = CURRENT_TIMESTAMP WHERE id = ?").run(row.id);
  return { token, user: mapUser({ ...row, lastActiveAt: new Date().toISOString() }) };
}

export function getUserBySessionToken(token?: string | null) {
  ensureDefaultAdmin();
  if (!token) return null;
  const row = db.prepare(`
    SELECT u.id, u.name, u.email, u.role, u.active, u.must_change_password as mustChangePassword, u.last_active_at as lastActiveAt, u.created_at as createdAt
    FROM auth_sessions s
    JOIN app_users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > CURRENT_TIMESTAMP
  `).get(hashToken(token)) as Record<string, unknown> | undefined;
  if (!row || !row.active) return null;
  db.prepare("UPDATE app_users SET last_active_at = CURRENT_TIMESTAMP WHERE id = ?").run(row.id);
  return mapUser(row);
}

export function countRecentlyActiveUsers(windowMinutes = 30) {
  ensureDefaultAdmin();
  const row = db.prepare(`
    SELECT COUNT(*) as count
    FROM app_users
    WHERE active = 1
      AND last_active_at IS NOT NULL
      AND last_active_at >= datetime('now', ?)
  `).get(`-${windowMinutes} minutes`) as { count: number };
  return row.count;
}

export function logoutSession(token?: string | null) {
  if (!token) return;
  db.prepare("DELETE FROM auth_sessions WHERE token_hash = ?").run(hashToken(token));
}

export type ChatMessage = { role: "user" | "assistant"; content: string };

export function listSessions(projectId?: number | null) {
  const filter = projectId === undefined ? "" : projectId === null ? "WHERE s.project_id IS NULL" : "WHERE s.project_id = ?";
  const query = `SELECT s.id, s.title, s.user_name as userName, s.project_id as projectId, s.created_at as createdAt, s.updated_at as updatedAt, (SELECT content FROM chat_messages m WHERE m.session_id = s.id ORDER BY m.id LIMIT 1) as firstMessage FROM chat_sessions s ${filter} ORDER BY s.updated_at DESC LIMIT 100`;
  const rows = (projectId === undefined || projectId === null ? db.prepare(query).all() : db.prepare(query).all(projectId)) as Array<Record<string, string>>;
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = row.firstMessage || row.title;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(({ firstMessage, ...row }) => ({ ...row, title: firstMessage || row.title }));
}

export function getSession(id: string) {
  const session = db.prepare("SELECT id, title, user_name as userName, project_id as projectId, created_at as createdAt, updated_at as updatedAt FROM chat_sessions WHERE id = ?").get(id);
  if (!session) return null;
  const messages = (db.prepare("SELECT role, content, metadata, created_at as createdAt FROM chat_messages WHERE session_id = ? ORDER BY id").all(id) as Array<{ role: string; content: string; metadata?: string }>).map((message) => ({ ...message, citations: message.metadata ? JSON.parse(message.metadata).citations || [] : [] }));
  return { ...session, messages };
}

export function getSessionByTitle(title: string, projectId?: number | null) {
  const projectFilter = projectId === undefined ? "" : projectId === null ? "AND s.project_id IS NULL" : "AND s.project_id = ?";
  const query = `SELECT s.id FROM chat_sessions s WHERE (s.title = ? OR EXISTS (SELECT 1 FROM chat_messages m WHERE m.session_id = s.id AND m.role = 'user' AND m.content = ?)) ${projectFilter} ORDER BY s.updated_at DESC LIMIT 1`;
  const session = (projectId === undefined || projectId === null ? db.prepare(query).get(title, title) : db.prepare(query).get(title, title, projectId)) as { id: string } | undefined;
  return session ? getSession(session.id) : null;
}

export function saveConversation(id: string, title: string, messages: Array<ChatMessage & { citations?: unknown[] }>, projectId?: number | null) {
  const transaction = db.transaction(() => {
    db.prepare("INSERT INTO chat_sessions (id, title, project_id) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET title=excluded.title, project_id=excluded.project_id, updated_at=CURRENT_TIMESTAMP").run(id, title, projectId ?? null);
    db.prepare("DELETE FROM chat_messages WHERE session_id = ?").run(id);
    const insert = db.prepare("INSERT INTO chat_messages (session_id, role, content, metadata) VALUES (?, ?, ?, ?)");
    for (const message of messages) insert.run(id, message.role, message.content, JSON.stringify({ citations: message.citations || [] }));
  });
  transaction();
}

export function saveFeedback(sessionId: string, rating: "up" | "down") {
  db.prepare("INSERT INTO message_feedback (session_id, rating) VALUES (?, ?)").run(sessionId, rating);
}

export function listFeedback() {
  return db.prepare("SELECT f.id, f.session_id as sessionId, f.rating, f.created_at as createdAt, (SELECT query FROM query_events q WHERE q.session_id = f.session_id ORDER BY q.id DESC LIMIT 1) as query FROM message_feedback f ORDER BY f.id DESC LIMIT 100").all();
}

export function saveQueryEvent(event: { sessionId: string; query: string; model?: string; latencyMs?: number; chunks?: number; topScore?: number | null; sources?: string[] }) {
  db.prepare("INSERT INTO query_events (session_id, query, model, latency_ms, chunks, top_score, sources) VALUES (?, ?, ?, ?, ?, ?, ?)").run(event.sessionId, event.query, event.model || null, event.latencyMs || null, event.chunks || 0, event.topScore ?? null, JSON.stringify(event.sources || []));
}
export function getQueryStats() {
  const rawRows = db.prepare("SELECT q.id, q.query, q.model, q.latency_ms as latencyMs, q.chunks, q.top_score as topScore, q.sources, q.created_at as createdAt, (SELECT rating FROM message_feedback f WHERE f.session_id = q.session_id ORDER BY f.id DESC LIMIT 1) as feedback, r.expected_source as expectedSource, r.verdict, r.notes, rr.resolution, rr.notes as resolutionNotes, rr.closed_at as closedAt FROM query_events q LEFT JOIN retrieval_reviews r ON r.query_event_id = q.id LEFT JOIN retrieval_resolutions rr ON rr.query_event_id = q.id ORDER BY q.id DESC LIMIT 100").all() as Array<Record<string, unknown>>;
  const rows = rawRows.map((row) => ({ ...row, sources: row.sources ? JSON.parse(String(row.sources)) : [] }));
  const avg = db.prepare("SELECT AVG(latency_ms) as average FROM query_events WHERE latency_ms IS NOT NULL").get() as { average?: number };
  return { rows, averageLatencyMs: avg.average ? Math.round(avg.average) : null };
}
export function saveRetrievalReview(review: { queryEventId: number; expectedSource?: string; verdict: "relevant" | "miss"; notes?: string }) {
  db.prepare("INSERT INTO retrieval_reviews (query_event_id, expected_source, verdict, notes) VALUES (?, ?, ?, ?) ON CONFLICT(query_event_id) DO UPDATE SET expected_source=excluded.expected_source, verdict=excluded.verdict, notes=excluded.notes, reviewed_at=CURRENT_TIMESTAMP").run(review.queryEventId, review.expectedSource || null, review.verdict, review.notes || null);
}
export function saveRetrievalResolution(resolution: { queryEventId: number; resolution: string; notes?: string }) {
  db.prepare("INSERT INTO retrieval_resolutions (query_event_id, resolution, notes) VALUES (?, ?, ?) ON CONFLICT(query_event_id) DO UPDATE SET resolution=excluded.resolution, notes=excluded.notes, closed_at=CURRENT_TIMESTAMP").run(resolution.queryEventId, resolution.resolution, resolution.notes || null);
}
export function getActiveModelConfig() { return db.prepare("SELECT id, generation_model as generationModel, embedding_model as embeddingModel, system_prompt as systemPrompt, active, created_at as createdAt FROM model_configs ORDER BY active DESC, id DESC LIMIT 1").get(); }
export function saveModelConfig(config: { generationModel: string; embeddingModel: string; systemPrompt: string; active?: boolean }) { if (config.active) db.prepare("UPDATE model_configs SET active=0").run(); db.prepare("INSERT INTO model_configs (generation_model, embedding_model, system_prompt, active) VALUES (?, ?, ?, ?)").run(config.generationModel, config.embeddingModel, config.systemPrompt, config.active ? 1 : 0); }
export function getSettings() { return db.prepare("SELECT key, value FROM system_settings").all() as Array<{ key: string; value: string }>; }
export function saveSetting(key: string, value: boolean) { db.prepare("INSERT INTO system_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP").run(key, value ? "true" : "false"); }
export function saveSettingValue(key: string, value: string) { db.prepare("INSERT INTO system_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP").run(key, value); }

export type KnowledgeProject = {
  id: number;
  name: string;
  description: string;
  createdBy: string;
  createdAt: string;
  threadCount: number;
};

export function listProjects() {
  return db.prepare(`
    SELECT p.id, p.name, p.description, p.created_by as createdBy, p.created_at as createdAt,
      COUNT(s.id) as threadCount
    FROM projects p
    LEFT JOIN chat_sessions s ON s.project_id = p.id
    GROUP BY p.id
    ORDER BY p.id
  `).all() as KnowledgeProject[];
}

export function createProject(project: { name: string; description?: string; createdBy?: string }) {
  const result = db.prepare("INSERT INTO projects (name, description, created_by) VALUES (?, ?, ?)").run(project.name, project.description || "", project.createdBy || "Seshu");
  return db.prepare("SELECT id, name, description, created_by as createdBy, created_at as createdAt, 0 as threadCount FROM projects WHERE id = ?").get(result.lastInsertRowid) as KnowledgeProject;
}
