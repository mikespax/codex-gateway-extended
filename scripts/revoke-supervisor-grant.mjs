#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const tokenFileIndex = process.argv.indexOf("--token-file");
const tokenFile = tokenFileIndex === -1 ? "" : (process.argv[tokenFileIndex + 1] ?? "");
if (tokenFile.trim() === "") {
  console.error("Usage: node scripts/revoke-supervisor-grant.mjs --token-file <path>");
  process.exit(1);
}
const token = readFileSync(resolve(tokenFile), "utf8").trim();
const tokenHash = createHash("sha256").update(token).digest("hex");
const dbPath = resolve(process.env.CODEX_GATEWAY_DB_PATH || "/data/codex-gateway.db");
const db = new DatabaseSync(dbPath);
const result = db
  .prepare(
    "UPDATE supervisor_grants SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL",
  )
  .run(new Date().toISOString(), tokenHash);
console.log(JSON.stringify({ revoked: Number(result.changes) === 1 }));
