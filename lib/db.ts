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
    user_email TEXT,
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
    rating TEXT NOT NULL CHECK (rating IN ('up','down','neutral')),
    note TEXT,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
    resolved_at TEXT,
    resolution_note TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS in_app_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    feedback_id INTEGER REFERENCES message_feedback(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    detail TEXT NOT NULL,
    read_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS query_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    user_name TEXT,
    query TEXT NOT NULL,
    model TEXT,
    latency_ms INTEGER,
    chunks INTEGER NOT NULL DEFAULT 0,
    top_score REAL,
    sources TEXT,
    response_id TEXT,
    filter_used TEXT,
    max_num_results INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS retrieval_traces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    query_event_id INTEGER NOT NULL REFERENCES query_events(id) ON DELETE CASCADE,
    document_id TEXT,
    file_id TEXT,
    filename TEXT,
    retrieved_text TEXT,
    retrieval_score REAL,
    citation TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    openai_file_id TEXT,
    vector_store_file_id TEXT,
    name TEXT NOT NULL,
    mime_type TEXT,
    size_bytes INTEGER,
    department_id TEXT NOT NULL DEFAULT 'general',
    folder_id TEXT NOT NULL DEFAULT 'uploaded-documents',
    document_type TEXT NOT NULL DEFAULT 'document',
    status TEXT NOT NULL DEFAULT 'processing',
    version INTEGER NOT NULL DEFAULT 1,
    is_current INTEGER NOT NULL DEFAULT 1,
    access_group TEXT NOT NULL DEFAULT 'all',
    owner_name TEXT NOT NULL DEFAULT 'Unknown user',
    error TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS processing_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    error TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
    role TEXT NOT NULL CHECK (role IN ('Admin','User')),
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
  CREATE TABLE IF NOT EXISTS notification_teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    collection_key TEXT NOT NULL UNIQUE,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS notification_team_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id INTEGER NOT NULL REFERENCES notification_teams(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(team_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS document_team_mappings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_key TEXT NOT NULL,
    document_version INTEGER NOT NULL DEFAULT 1,
    team_id INTEGER NOT NULL REFERENCES notification_teams(id) ON DELETE CASCADE,
    uploaded_by TEXT,
    uploaded_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(document_key, document_version)
  );
  CREATE TABLE IF NOT EXISTS document_notification_deliveries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_key TEXT NOT NULL,
    document_version INTEGER NOT NULL DEFAULT 1,
    team_id INTEGER NOT NULL REFERENCES notification_teams(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
    sent_at TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(document_key, document_version, user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id, id);
  CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated ON chat_sessions(updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_auth_sessions_token ON auth_sessions(token_hash);
  CREATE INDEX IF NOT EXISTS idx_document_team_mappings_team ON document_team_mappings(team_id);
  CREATE INDEX IF NOT EXISTS idx_notification_deliveries_status ON document_notification_deliveries(status);
`);

for (const team of [
  ["Business Intelligence", "business-intelligence"],
  ["Content & Storytelling", "content-storytelling"],
  ["Collective Design & Support", "collective-design-support"],
  ["Community Engagement", "community-engagement"],
  ["Regolith", "regolith"],
  ["Legal & Liaisoning", "legal-liaisoning"],
  ["HR", "hr"],
  ["Finance & Accounts", "finance-accounts"],
  ["Collective Operations", "collective-operations"],
  ["Bewild", "bewild"],
] as const) {
  db.prepare("INSERT OR IGNORE INTO notification_teams (name, collection_key) VALUES (?, ?)").run(...team);
}
db.prepare("INSERT OR IGNORE INTO projects (name, description) VALUES (?, ?)").run("Beforest knowledge", "Shared Beforest knowledge base");
try { db.exec("ALTER TABLE chat_messages ADD COLUMN metadata TEXT"); } catch { /* existing database already migrated */ }
try { db.exec("ALTER TABLE chat_sessions ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL"); } catch { /* existing database already migrated */ }
try { db.exec("ALTER TABLE chat_sessions ADD COLUMN user_email TEXT"); } catch { /* existing database already migrated */ }
try {
  db.exec(`
    UPDATE chat_sessions
    SET user_email = (
      SELECT lower(app_users.email)
      FROM app_users
      WHERE app_users.name = chat_sessions.user_name
    )
    WHERE user_email IS NULL
      AND (
        SELECT COUNT(*)
        FROM app_users
        WHERE app_users.name = chat_sessions.user_name
      ) = 1
  `);
} catch { /* user table may not be seeded yet */ }
try { db.exec("ALTER TABLE query_events ADD COLUMN top_score REAL"); } catch { /* existing database already migrated */ }
try { db.exec("ALTER TABLE query_events ADD COLUMN sources TEXT"); } catch { /* existing database already migrated */ }
try { db.exec("ALTER TABLE query_events ADD COLUMN user_name TEXT"); } catch { /* existing database already migrated */ }
try { db.exec("ALTER TABLE query_events ADD COLUMN response_id TEXT"); } catch { /* existing database already migrated */ }
try { db.exec("ALTER TABLE query_events ADD COLUMN filter_used TEXT"); } catch { /* existing database already migrated */ }
try { db.exec("ALTER TABLE query_events ADD COLUMN max_num_results INTEGER"); } catch { /* existing database already migrated */ }
try { db.prepare("UPDATE app_users SET role = 'User' WHERE role = 'Contributor'").run(); } catch { /* app users table may not be available yet */ }
try {
  const feedbackTable = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='message_feedback'").get() as { sql?: string } | undefined;
  if (feedbackTable?.sql && (!feedbackTable.sql.includes("'neutral'") || !feedbackTable.sql.includes("note TEXT"))) {
    db.exec(`
      ALTER TABLE message_feedback RENAME TO message_feedback_old;
      CREATE TABLE message_feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        rating TEXT NOT NULL CHECK (rating IN ('up','down','neutral')),
        note TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO message_feedback (id, session_id, rating, note, created_at)
      SELECT id, session_id, rating, NULL, created_at FROM message_feedback_old;
      DROP TABLE message_feedback_old;
    `);
  }
} catch { /* existing database already migrated */ }
try { db.exec("ALTER TABLE message_feedback ADD COLUMN status TEXT NOT NULL DEFAULT 'open'"); } catch { /* existing database already migrated */ }
try { db.exec("ALTER TABLE message_feedback ADD COLUMN resolved_at TEXT"); } catch { /* existing database already migrated */ }
try { db.exec("ALTER TABLE message_feedback ADD COLUMN resolution_note TEXT"); } catch { /* existing database already migrated */ }

export type AppRole = "Admin" | "User";
export type AppUser = {
  id: number;
  name: string;
  email: string;
  role: AppRole;
  teamId?: number | null;
  active: boolean;
  mustChangePassword: boolean;
  lastActiveAt?: string | null;
  createdAt: string;
};

export type NotificationTeam = {
  id: number;
  name: string;
  collectionKey: string;
  active: boolean;
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
  const role = row.role === "Admin" ? "Admin" : "User";
  return {
    id: Number(row.id),
    name: String(row.name),
    email: String(row.email),
    role,
    teamId: row.teamId === null || row.teamId === undefined ? null : Number(row.teamId),
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
  return (db.prepare("SELECT u.id, u.name, u.email, u.role, u.active, u.must_change_password as mustChangePassword, u.last_active_at as lastActiveAt, u.created_at as createdAt, (SELECT team_id FROM notification_team_members WHERE user_id = u.id AND active = 1 LIMIT 1) as teamId FROM app_users u ORDER BY u.id").all() as Array<Record<string, unknown>>).map(mapUser);
}

export function listNotificationTeams() {
  return (db.prepare("SELECT id, name, collection_key as collectionKey, active, created_at as createdAt FROM notification_teams WHERE active = 1 ORDER BY name").all() as Array<Record<string, unknown>>).map((row) => ({
    id: Number(row.id),
    name: String(row.name),
    collectionKey: String(row.collectionKey),
    active: Boolean(row.active),
    createdAt: String(row.createdAt),
  })) as NotificationTeam[];
}

export function notificationTeamExists(teamId: number) {
  return Boolean(db.prepare("SELECT id FROM notification_teams WHERE id = ? AND active = 1").get(teamId));
}

export function assignUserToTeam(userId: number, teamId: number) {
  if (!notificationTeamExists(teamId)) return false;
  const transaction = db.transaction(() => {
    db.prepare("UPDATE notification_team_members SET active = 0 WHERE user_id = ?").run(userId);
    db.prepare("INSERT INTO notification_team_members (team_id, user_id, active) VALUES (?, ?, 1) ON CONFLICT(team_id, user_id) DO UPDATE SET active = 1").run(teamId, userId);
  });
  transaction();
  return true;
}

export function getNotificationTeamByCollectionKey(collectionKey: string) {
  return db.prepare("SELECT id, name, collection_key as collectionKey FROM notification_teams WHERE collection_key = ? AND active = 1").get(collectionKey) as { id: number; name: string; collectionKey: string } | undefined;
}

export function getNotificationTeam(teamId: number) {
  return db.prepare("SELECT id, name, collection_key as collectionKey FROM notification_teams WHERE id = ? AND active = 1").get(teamId) as { id: number; name: string; collectionKey: string } | undefined;
}

export function prepareDocumentNotificationDeliveries(input: { documentKey: string; documentVersion: number; teamId: number }) {
  const recipients = db.prepare(`
    SELECT u.id as userId, u.name, u.email, d.status
    FROM notification_team_members m
    JOIN app_users u ON u.id = m.user_id
    LEFT JOIN document_notification_deliveries d
      ON d.document_key = ? AND d.document_version = ? AND d.team_id = m.team_id AND d.user_id = u.id
    WHERE m.team_id = ? AND m.active = 1 AND u.active = 1
    ORDER BY u.id
  `).all(input.documentKey, input.documentVersion, input.teamId) as Array<{ userId: number; name: string; email: string; status?: "pending" | "sent" | "failed" | "skipped" }>;
  const insert = db.prepare(`
    INSERT OR IGNORE INTO document_notification_deliveries
      (document_key, document_version, team_id, user_id, status)
    VALUES (?, ?, ?, ?, 'pending')
  `);
  const transaction = db.transaction(() => {
    for (const recipient of recipients) insert.run(input.documentKey, input.documentVersion, input.teamId, recipient.userId);
  });
  transaction();
  return recipients.map((recipient) => ({
    ...recipient,
    deliveryId: Number((db.prepare(`
      SELECT id FROM document_notification_deliveries
      WHERE document_key = ? AND document_version = ? AND team_id = ? AND user_id = ?
    `).get(input.documentKey, input.documentVersion, input.teamId, recipient.userId) as { id: number }).id),
  }));
}

export function markDocumentNotificationDelivery(id: number, status: "sent" | "failed", errorMessage?: string) {
  db.prepare(`
    UPDATE document_notification_deliveries
    SET status = ?, sent_at = CASE WHEN ? = 'sent' THEN CURRENT_TIMESTAMP ELSE sent_at END,
        error_message = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(status, status, errorMessage || null, id);
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

function conversationOwnerWhere() {
  return "s.user_email IS NOT NULL AND lower(s.user_email) = lower(?)";
}

export function listSessions(projectId: number | null | undefined, userEmail: string) {
  const ownerFilter = conversationOwnerWhere();
  const projectFilter = projectId === undefined ? "" : projectId === null ? "AND s.project_id IS NULL" : "AND s.project_id = ?";
  const query = `SELECT s.id, s.title, s.user_name as userName, s.user_email as userEmail, s.project_id as projectId, s.created_at as createdAt, s.updated_at as updatedAt, (SELECT content FROM chat_messages m WHERE m.session_id = s.id ORDER BY m.id LIMIT 1) as firstMessage FROM chat_sessions s WHERE ${ownerFilter} ${projectFilter} ORDER BY s.updated_at DESC LIMIT 100`;
  const params = projectId === undefined || projectId === null ? [userEmail] : [userEmail, projectId];
  const rows = db.prepare(query).all(...params) as Array<Record<string, string>>;
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = row.firstMessage || row.title;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(({ firstMessage, ...row }) => ({ ...row, title: firstMessage || row.title }));
}

export function getSession(id: string, userEmail: string) {
  const session = db.prepare(`SELECT id, title, user_name as userName, user_email as userEmail, project_id as projectId, created_at as createdAt, updated_at as updatedAt FROM chat_sessions s WHERE id = ? AND ${conversationOwnerWhere()}`).get(id, userEmail);
  if (!session) return null;
  const messages = (db.prepare("SELECT role, content, metadata, created_at as createdAt FROM chat_messages WHERE session_id = ? ORDER BY id").all(id) as Array<{ role: string; content: string; metadata?: string }>).map((message) => ({ ...message, citations: message.metadata ? JSON.parse(message.metadata).citations || [] : [] }));
  return { ...session, messages };
}

export function getSessionByTitle(title: string, projectId: number | null | undefined, userEmail: string) {
  const projectFilter = projectId === undefined ? "" : projectId === null ? "AND s.project_id IS NULL" : "AND s.project_id = ?";
  const query = `SELECT s.id FROM chat_sessions s WHERE ${conversationOwnerWhere()} AND (s.title = ? OR EXISTS (SELECT 1 FROM chat_messages m WHERE m.session_id = s.id AND m.role = 'user' AND m.content = ?)) ${projectFilter} ORDER BY s.updated_at DESC LIMIT 1`;
  const params = projectId === undefined || projectId === null ? [userEmail, title, title] : [userEmail, title, title, projectId];
  const session = db.prepare(query).get(...params) as { id: string } | undefined;
  return session ? getSession(session.id, userEmail) : null;
}

export function saveConversation(id: string, title: string, messages: Array<ChatMessage & { citations?: unknown[] }>, projectId?: number | null, userName = "Seshu", userEmail?: string) {
  const transaction = db.transaction(() => {
    db.prepare("INSERT INTO chat_sessions (id, title, user_name, user_email, project_id) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET title=excluded.title, user_name=excluded.user_name, user_email=excluded.user_email, project_id=excluded.project_id, updated_at=CURRENT_TIMESTAMP").run(id, title, userName, userEmail?.toLowerCase() || null, projectId ?? null);
    db.prepare("DELETE FROM chat_messages WHERE session_id = ?").run(id);
    const insert = db.prepare("INSERT INTO chat_messages (session_id, role, content, metadata) VALUES (?, ?, ?, ?)");
    for (const message of messages) insert.run(id, message.role, message.content, JSON.stringify({ citations: message.citations || [] }));
  });
  transaction();
}

export function saveFeedback(sessionId: string, rating: "up" | "down" | "neutral", note?: string) {
  db.prepare("INSERT INTO message_feedback (session_id, rating, note) VALUES (?, ?, ?)").run(sessionId, rating, note?.trim() || null);
}

export function listFeedback() {
  return db.prepare("SELECT f.id, f.session_id as sessionId, f.rating, f.note, COALESCE(f.status, 'open') as status, f.resolved_at as resolvedAt, f.resolution_note as resolutionNote, f.created_at as createdAt, COALESCE(s.user_name, 'Unknown user') as userName, (SELECT query FROM query_events q WHERE q.session_id = f.session_id ORDER BY q.id DESC LIMIT 1) as query, EXISTS (SELECT 1 FROM in_app_notifications n WHERE n.feedback_id = f.id) as notificationSent FROM message_feedback f LEFT JOIN chat_sessions s ON s.id = f.session_id ORDER BY f.id DESC LIMIT 100").all();
}

export function resolveFeedback(feedbackId: number, resolutionNote?: string) {
  const result = { resolved: false, notified: false };
  const transaction = db.transaction(() => {
    const feedback = db.prepare("SELECT f.id, f.status, s.user_email as userEmail, s.user_name as userName, (SELECT query FROM query_events q WHERE q.session_id = f.session_id ORDER BY q.id DESC LIMIT 1) as query FROM message_feedback f LEFT JOIN chat_sessions s ON s.id = f.session_id WHERE f.id = ?").get(feedbackId) as { id: number; status: string; userEmail?: string | null; userName?: string | null; query?: string | null } | undefined;
    if (!feedback) return;
    db.prepare("UPDATE message_feedback SET status = 'resolved', resolved_at = CURRENT_TIMESTAMP, resolution_note = ? WHERE id = ?").run(resolutionNote?.trim() || null, feedbackId);
    const recipient = (feedback.userEmail ? db.prepare("SELECT id FROM app_users WHERE lower(email) = lower(?) AND active = 1").get(feedback.userEmail) : undefined) as { id: number } | undefined
      || (feedback.userName ? db.prepare("SELECT id FROM app_users WHERE lower(name) = lower(?) AND active = 1 ORDER BY id LIMIT 1").get(feedback.userName) as { id: number } | undefined : undefined);
    if (recipient) {
      if (!db.prepare("SELECT 1 FROM in_app_notifications WHERE feedback_id = ?").get(feedbackId)) db.prepare("INSERT INTO in_app_notifications (user_id, feedback_id, title, detail) VALUES (?, ?, ?, ?)").run(recipient.id, feedbackId, "Feedback resolved", "Your feedback is resolved.");
      result.notified = true;
    }
    result.resolved = true;
  });
  transaction();
  return result;
}

export function listInAppNotifications(userId: number) {
  return db.prepare("SELECT id, feedback_id as feedbackId, title, detail, read_at as readAt, created_at as createdAt FROM in_app_notifications WHERE user_id = ? ORDER BY id DESC LIMIT 25").all(userId);
}

export type RetrievalTrace = {
  documentId?: string | null;
  fileId?: string | null;
  filename?: string | null;
  retrievedText?: string | null;
  retrievalScore?: number | null;
  citation?: string | null;
};

export function saveQueryEvent(event: {
  sessionId: string;
  userName?: string;
  query: string;
  model?: string;
  latencyMs?: number;
  chunks?: number;
  topScore?: number | null;
  sources?: string[];
  responseId?: string | null;
  filterUsed?: unknown;
  maxNumResults?: number;
  traces?: RetrievalTrace[];
}) {
  const transaction = db.transaction(() => {
    const result = db.prepare("INSERT INTO query_events (session_id, user_name, query, model, latency_ms, chunks, top_score, sources, response_id, filter_used, max_num_results) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      event.sessionId,
      event.userName || null,
      event.query,
      event.model || null,
      event.latencyMs || null,
      event.chunks || 0,
      event.topScore ?? null,
      JSON.stringify(event.sources || []),
      event.responseId || null,
      event.filterUsed ? JSON.stringify(event.filterUsed) : null,
      event.maxNumResults || null,
    );
    const queryEventId = Number(result.lastInsertRowid);
    const insertTrace = db.prepare("INSERT INTO retrieval_traces (query_event_id, document_id, file_id, filename, retrieved_text, retrieval_score, citation) VALUES (?, ?, ?, ?, ?, ?, ?)");
    for (const trace of event.traces || []) {
      insertTrace.run(
        queryEventId,
        trace.documentId || null,
        trace.fileId || null,
        trace.filename || null,
        trace.retrievedText || null,
        trace.retrievalScore ?? null,
        trace.citation || trace.filename || null,
      );
    }
    return queryEventId;
  });
  return transaction();
}
export function getQueryStats() {
  const rawRows = db.prepare("SELECT q.id, COALESCE(q.user_name, s.user_name, 'Unknown user') as userName, q.query, q.model, q.latency_ms as latencyMs, q.chunks, q.top_score as topScore, q.sources, q.response_id as responseId, q.filter_used as filterUsed, q.max_num_results as maxNumResults, q.created_at as createdAt, (SELECT rating FROM message_feedback f WHERE f.session_id = q.session_id ORDER BY f.id DESC LIMIT 1) as feedback, r.expected_source as expectedSource, r.verdict, r.notes, rr.resolution, rr.notes as resolutionNotes, rr.closed_at as closedAt FROM query_events q LEFT JOIN chat_sessions s ON s.id = q.session_id LEFT JOIN retrieval_reviews r ON r.query_event_id = q.id LEFT JOIN retrieval_resolutions rr ON rr.query_event_id = q.id ORDER BY q.id DESC LIMIT 100").all() as Array<Record<string, unknown>>;
  const traceRows = db.prepare("SELECT query_event_id as queryEventId, document_id as documentId, file_id as fileId, filename, retrieved_text as retrievedText, retrieval_score as retrievalScore, citation FROM retrieval_traces ORDER BY id").all() as Array<Record<string, unknown>>;
  const tracesByQuery = traceRows.reduce<Record<number, Array<Record<string, unknown>>>>((result, trace) => {
    const queryEventId = Number(trace.queryEventId);
    (result[queryEventId] ||= []).push(trace);
    return result;
  }, {});
  const rows = rawRows.map((row) => ({
    ...row,
    sources: row.sources ? JSON.parse(String(row.sources)) : [],
    filterUsed: row.filterUsed ? JSON.parse(String(row.filterUsed)) : null,
    traces: tracesByQuery[Number(row.id)] || [],
  }));
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

export function getSettingValue(key: string, fallback = "") {
  const row = db.prepare("SELECT value FROM system_settings WHERE key = ?").get(key) as { value?: string } | undefined;
  return row?.value ?? fallback;
}

export function getNumberSetting(key: string, fallback: number, options?: { min?: number; max?: number }) {
  const raw = Number(getSettingValue(key, String(fallback)));
  const value = Number.isFinite(raw) ? raw : fallback;
  return Math.min(options?.max ?? value, Math.max(options?.min ?? value, value));
}

export function createDocumentRecord(document: {
  id: string;
  name: string;
  mimeType?: string;
  sizeBytes?: number;
  departmentId?: string;
  folderId?: string;
  documentType?: string;
  accessGroup?: string;
  ownerName?: string;
  version?: number;
}) {
  db.prepare(`
    INSERT INTO documents (id, name, mime_type, size_bytes, department_id, folder_id, document_type, access_group, owner_name, version, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'processing')
  `).run(
    document.id,
    document.name,
    document.mimeType || null,
    document.sizeBytes || null,
    document.departmentId || "general",
    document.folderId || "uploaded-documents",
    document.documentType || "document",
    document.accessGroup || "all",
    document.ownerName || "Unknown user",
    document.version || 1,
  );
  db.prepare("INSERT INTO processing_jobs (document_id, type, status) VALUES (?, 'openai_vector_index', 'processing')").run(document.id);
}

export function updateDocumentRecord(id: string, updates: Partial<{
  openaiFileId: string | null;
  vectorStoreFileId: string | null;
  status: string;
  error: string | null;
}>) {
  const existing = db.prepare("SELECT id FROM documents WHERE id = ?").get(id);
  if (!existing) return null;
  if (updates.openaiFileId !== undefined) db.prepare("UPDATE documents SET openai_file_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(updates.openaiFileId, id);
  if (updates.vectorStoreFileId !== undefined) db.prepare("UPDATE documents SET vector_store_file_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(updates.vectorStoreFileId, id);
  if (updates.status !== undefined) {
    db.prepare("UPDATE documents SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(updates.status, id);
    db.prepare("UPDATE processing_jobs SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE document_id = ?").run(updates.status === "published" || updates.status === "ready" ? "completed" : updates.status, id);
  }
  if (updates.error !== undefined) {
    db.prepare("UPDATE documents SET error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(updates.error, id);
    if (updates.error) db.prepare("UPDATE processing_jobs SET error = ?, status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE document_id = ?").run(updates.error, id);
  }
  return db.prepare("SELECT * FROM documents WHERE id = ?").get(id);
}

export function softDeleteDocumentByFileId(fileId: string) {
  db.prepare("UPDATE documents SET status = 'deleted', is_current = 0, updated_at = CURRENT_TIMESTAMP WHERE openai_file_id = ? OR vector_store_file_id = ?").run(fileId, fileId);
}

export function getDocumentByFileId(fileId: string) {
  return db.prepare("SELECT id, name, mime_type as mimeType, size_bytes as sizeBytes, department_id as departmentId, folder_id as folderId, document_type as documentType, status, version, is_current as isCurrent, access_group as accessGroup, owner_name as ownerName FROM documents WHERE openai_file_id = ? OR vector_store_file_id = ? ORDER BY updated_at DESC LIMIT 1").get(fileId, fileId) as Record<string, unknown> | undefined;
}

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
