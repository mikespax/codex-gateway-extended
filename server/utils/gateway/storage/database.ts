import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { trimmedOrFallback } from "~~/shared/utils/strings";

let database: DatabaseSync | null = null;
let ready = false;
const readyCallbacks = new Set<() => void>();

function gatewayDatabasePath() {
  return resolve(trimmedOrFallback(process.env.CODEX_GATEWAY_DB_PATH, "/data/codex-gateway.db"));
}

export function gatewayDatabaseExists() {
  return existsSync(gatewayDatabasePath());
}

export function gatewayDatabaseReady() {
  return ready;
}

export function onGatewayDatabaseReady(callback: () => void) {
  readyCallbacks.add(callback);
  if (ready) {
    callback();
  }
  return () => {
    readyCallbacks.delete(callback);
  };
}

export function gatewayDatabase() {
  if (database === null) {
    const path = gatewayDatabasePath();
    const directory = dirname(path);
    if (!existsSync(directory)) {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
    }
    database = new DatabaseSync(path);
    database.exec("PRAGMA journal_mode = WAL");
    database.exec("PRAGMA foreign_keys = ON");
    database.exec("PRAGMA busy_timeout = 5000");
    migrate(database);
    markGatewayDatabaseReady();
  }
  return database;
}

export function withGatewayDatabaseTransaction<T>(callback: (db: DatabaseSync) => T): T {
  const db = gatewayDatabase();
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = callback(db);
    db.exec("COMMIT");
    return result;
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw error;
  }
}

function markGatewayDatabaseReady() {
  if (ready) {
    return;
  }
  ready = true;
  for (const callback of Array.from(readyCallbacks)) {
    callback();
  }
}

function migrate(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS user_configs (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      encrypted_config_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tmux_monitors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      host_id INTEGER NOT NULL,
      project_id INTEGER,
      thread_id TEXT,
      thread_title TEXT,
      session_name TEXT NOT NULL,
      session_id TEXT NOT NULL,
      session_created INTEGER NOT NULL,
      window_index INTEGER NOT NULL,
      window_name TEXT NOT NULL,
      pane_index INTEGER NOT NULL,
      pane_id TEXT NOT NULL,
      pane_pid INTEGER NOT NULL,
      initial_command TEXT NOT NULL,
      last_command TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'once' CHECK (mode IN ('once', 'permanent')),
      status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'cancelled')),
      completion_reason TEXT,
      created_at TEXT NOT NULL,
      run_started_at TEXT,
      last_checked_at TEXT,
      completed_at TEXT,
      last_error TEXT,
      last_error_at TEXT,
      notification_sent_at TEXT
    );

    CREATE TABLE IF NOT EXISTS android_devices (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      fcm_token_hash TEXT NOT NULL,
      encrypted_fcm_token TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS android_notifications (
      device_id TEXT NOT NULL REFERENCES android_devices(id) ON DELETE CASCADE,
      notification_key TEXT NOT NULL,
      target_kind TEXT NOT NULL CHECK (target_kind IN ('thread', 'tmuxMonitor')),
      host_id INTEGER NOT NULL,
      project_id INTEGER,
      thread_id TEXT,
      monitor_id INTEGER,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      reply_allowed INTEGER NOT NULL DEFAULT 0,
      delivery_status TEXT NOT NULL CHECK (delivery_status IN ('pending', 'sent', 'failed')),
      delivery_error TEXT,
      created_at TEXT NOT NULL,
      sent_at TEXT,
      expires_at TEXT NOT NULL,
      replied_at TEXT,
      PRIMARY KEY (device_id, notification_key)
    );

    CREATE TABLE IF NOT EXISTS android_reply_requests (
      device_id TEXT NOT NULL REFERENCES android_devices(id) ON DELETE CASCADE,
      client_message_id TEXT NOT NULL,
      notification_key TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('processing', 'accepted', 'failed')),
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (device_id, client_message_id)
    );

    CREATE TABLE IF NOT EXISTS supervisor_grants (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      host_id INTEGER NOT NULL,
      project_id INTEGER,
      thread_id TEXT NOT NULL,
      label TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      created_at TEXT NOT NULL,
      last_used_at TEXT
    );

    CREATE TABLE IF NOT EXISTS thread_snapshot_cache (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      host_id INTEGER NOT NULL,
      thread_id TEXT NOT NULL,
      source_updated_at INTEGER NOT NULL,
      turn_count INTEGER NOT NULL,
      encrypted_snapshot_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_accessed_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      PRIMARY KEY (user_id, host_id, thread_id)
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_tmux_monitors_host
      ON tmux_monitors(user_id, host_id, status, created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tmux_monitors_active_location
      ON tmux_monitors(user_id, host_id, session_name, window_index, pane_index)
      WHERE status = 'active';
    CREATE INDEX IF NOT EXISTS idx_android_devices_user
      ON android_devices(user_id, is_active, created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_android_devices_active_fcm
      ON android_devices(user_id, fcm_token_hash) WHERE is_active = 1;
    CREATE INDEX IF NOT EXISTS idx_android_notifications_expiry
      ON android_notifications(device_id, expires_at);
    CREATE INDEX IF NOT EXISTS idx_supervisor_grants_token_hash
      ON supervisor_grants(token_hash);
    CREATE INDEX IF NOT EXISTS idx_supervisor_grants_expiry
      ON supervisor_grants(user_id, expires_at);
    CREATE INDEX IF NOT EXISTS idx_thread_snapshot_cache_lru
      ON thread_snapshot_cache(user_id, last_accessed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_thread_snapshot_cache_expiry
      ON thread_snapshot_cache(expires_at);
  `);

  ensureSupervisorGrantColumns(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS supervisor_message_requests (
      grant_id TEXT NOT NULL REFERENCES supervisor_grants(id) ON DELETE CASCADE,
      client_message_id TEXT NOT NULL,
      text_sha256 TEXT NOT NULL,
      text_length INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('processing', 'accepted', 'failed')),
      turn_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (grant_id, client_message_id)
    );

    CREATE INDEX IF NOT EXISTS idx_supervisor_message_requests_status
      ON supervisor_message_requests(grant_id, status, updated_at);
  `);
}

function ensureSupervisorGrantColumns(db: DatabaseSync) {
  const columns = new Set(
    db
      .prepare("PRAGMA table_info(supervisor_grants)")
      .all()
      .map((row) => String(row.name)),
  );
  if (!columns.has("permissions_json")) {
    db.exec(`
      ALTER TABLE supervisor_grants
      ADD COLUMN permissions_json TEXT NOT NULL
      DEFAULT '["thread.history.read","thread.events.read"]'
    `);
  }
  if (!columns.has("is_persistent")) {
    db.exec(`
      ALTER TABLE supervisor_grants
      ADD COLUMN is_persistent INTEGER NOT NULL DEFAULT 0
    `);
  }
}
