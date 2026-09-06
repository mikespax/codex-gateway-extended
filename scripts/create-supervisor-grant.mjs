#!/usr/bin/env node
import { createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const args = parseArgs(process.argv.slice(2));
const username = required(args, "username").trim().toLowerCase();
const title = required(args, "title").trim();
const outputPath = resolve(required(args, "output"));
const persistent = booleanValue(args.persistent ?? "false", "persistent");
const allowSend = booleanValue(args["allow-send"] ?? "false", "allow-send");
const hours = persistent ? null : positiveNumber(args.hours ?? "24", "hours");
if (hours !== null && hours > 168) fail("Expiring supervisor grants may not exceed 168 hours");
if (existsSync(outputPath)) fail(`Refusing to overwrite existing token file: ${outputPath}`);

const dbPath = resolve(process.env.CODEX_GATEWAY_DB_PATH || "/data/codex-gateway.db");
const configSecret = process.env.CODEX_GATEWAY_CONFIG_SECRET ?? "";
if (configSecret === "") fail("CODEX_GATEWAY_CONFIG_SECRET is required");

const db = new DatabaseSync(dbPath);
db.exec("PRAGMA foreign_keys = ON");
ensureGrantTable(db);
const row = db
  .prepare(
    `
      SELECT users.id, users.username, user_configs.encrypted_config_json
      FROM users
      JOIN user_configs ON user_configs.user_id = users.id
      WHERE users.username = ? AND users.is_active = 1
    `,
  )
  .get(username);
if (row === undefined) fail(`Active Gateway user not found: ${username}`);

const config = decryptConfig(String(row.encrypted_config_json), configSecret);
const matches = (config.pinnedThreads ?? []).filter(
  (item) => typeof item?.title === "string" && item.title.trim() === title,
);
if (matches.length !== 1) {
  fail(
    `Expected exactly one pinned thread titled ${JSON.stringify(title)}, found ${matches.length}`,
  );
}
const pinned = matches[0];
const host = (config.hosts ?? []).find((item) => item.id === pinned.hostId);
if (host === undefined) fail(`Pinned thread host ${pinned.hostId} is not configured`);

const token = `sg_${randomBytes(32).toString("base64url")}`;
const grantId = randomUUID();
const createdAt = new Date().toISOString();
const expiresAt =
  hours === null
    ? "9999-12-31T23:59:59.999Z"
    : new Date(Date.now() + hours * 3_600_000).toISOString();
const permissions = [
  "thread.history.read",
  "thread.events.read",
  ...(allowSend ? ["thread.projectManagement.send"] : []),
];
db.prepare(
  `
    INSERT INTO supervisor_grants
      (id, user_id, token_hash, host_id, project_id, thread_id, label,
       permissions_json, is_persistent, expires_at, revoked_at, created_at, last_used_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL)
  `,
).run(
  grantId,
  Number(row.id),
  createHash("sha256").update(token).digest("hex"),
  Number(pinned.hostId),
  pinned.projectId === null ? null : Number(pinned.projectId),
  String(pinned.threadId),
  title,
  JSON.stringify(permissions),
  persistent ? 1 : 0,
  expiresAt,
  createdAt,
);

try {
  mkdirSync(dirname(outputPath), { recursive: true, mode: 0o700 });
  writeFileSync(outputPath, `${token}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
} catch (error) {
  db.prepare("DELETE FROM supervisor_grants WHERE id = ?").run(grantId);
  throw error;
}

console.log(
  JSON.stringify(
    {
      grantId,
      username,
      hostId: Number(pinned.hostId),
      hostName: String(host.name),
      projectId: pinned.projectId === null ? null : Number(pinned.projectId),
      threadId: String(pinned.threadId),
      title,
      permissions,
      persistent,
      expiresAt: persistent ? null : expiresAt,
      tokenFile: outputPath,
    },
    null,
    2,
  ),
);

function decryptConfig(encrypted, secret) {
  const [version, ivText, tagText, ciphertextText] = encrypted.split("$");
  if (!ivText || !tagText || !ciphertextText || version !== "v1") {
    fail("Invalid encrypted Gateway config format");
  }
  const key = createHash("sha256").update(secret).digest();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(ciphertextText, "base64url")),
      decipher.final(),
    ]).toString("utf8"),
  );
}

function ensureGrantTable(database) {
  database.exec(`
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
    CREATE INDEX IF NOT EXISTS idx_supervisor_grants_token_hash
      ON supervisor_grants(token_hash);
    CREATE INDEX IF NOT EXISTS idx_supervisor_grants_expiry
      ON supervisor_grants(user_id, expires_at);
  `);
  const columns = new Set(
    database
      .prepare("PRAGMA table_info(supervisor_grants)")
      .all()
      .map((row) => String(row.name)),
  );
  if (!columns.has("permissions_json")) {
    database.exec(`
      ALTER TABLE supervisor_grants
      ADD COLUMN permissions_json TEXT NOT NULL
      DEFAULT '["thread.history.read","thread.events.read"]'
    `);
  }
  if (!columns.has("is_persistent")) {
    database.exec(`
      ALTER TABLE supervisor_grants
      ADD COLUMN is_persistent INTEGER NOT NULL DEFAULT 0
    `);
  }
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith("--") || value === undefined) fail("Arguments must use --name value");
    parsed[key.slice(2)] = value;
  }
  return parsed;
}

function required(values, key) {
  const value = values[key];
  if (typeof value !== "string" || value.trim() === "") fail(`--${key} is required`);
  return value;
}

function positiveNumber(value, key) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) fail(`--${key} must be a positive number`);
  return number;
}

function booleanValue(value, key) {
  if (value === "true") return true;
  if (value === "false") return false;
  fail(`--${key} must be true or false`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
