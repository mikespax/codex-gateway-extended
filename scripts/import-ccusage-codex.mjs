#!/usr/bin/env node

import { createHmac } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const SOURCE = "ccusage_codex";
const DEFAULT_DB_PATH = "/data/codex-gateway.db";

try {
  const input = JSON.parse(await readStdin());
  const database = openDatabase();
  const userId = requestedUserId(input, database);
  if (input?.source !== SOURCE) throw new Error(`Import source must be ${SOURCE}`);
  ensureSchema(database);
  const accountScopeId = usageAccountScopeId(userId);
  const records = normalizeRecords(input?.records);
  const importedAt = Date.now();

  database.exec("BEGIN IMMEDIATE");
  try {
    const statement = database.prepare(
      `INSERT INTO usage_historical_records (
        user_id, account_scope_id, source, source_record_id, source_fingerprint,
        source_hosts_json, total_tokens, input_tokens, cached_input_tokens,
        cache_write_input_tokens, output_tokens, reasoning_output_tokens,
        api_equivalent_cost_micros, pricing_version, pricing_completeness,
        observed_at, imported_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, account_scope_id, source, source_record_id) DO UPDATE SET
        source_fingerprint = excluded.source_fingerprint,
        source_hosts_json = excluded.source_hosts_json,
        total_tokens = excluded.total_tokens,
        input_tokens = excluded.input_tokens,
        cached_input_tokens = excluded.cached_input_tokens,
        cache_write_input_tokens = excluded.cache_write_input_tokens,
        output_tokens = excluded.output_tokens,
        reasoning_output_tokens = excluded.reasoning_output_tokens,
        api_equivalent_cost_micros = excluded.api_equivalent_cost_micros,
        pricing_version = excluded.pricing_version,
        pricing_completeness = excluded.pricing_completeness,
        observed_at = excluded.observed_at,
        imported_at = excluded.imported_at`,
    );
    for (const record of records) {
      statement.run(
        userId,
        accountScopeId,
        SOURCE,
        record.sourceRecordId,
        record.sourceFingerprint,
        JSON.stringify(record.sourceHosts),
        record.totalTokens,
        record.inputTokens,
        record.cachedInputTokens,
        record.cacheWriteInputTokens,
        record.outputTokens,
        record.reasoningOutputTokens,
        record.apiEquivalentCostMicros,
        record.pricingVersion,
        record.pricingCompleteness,
        record.observedAt,
        importedAt,
      );
    }
    database.exec("COMMIT");
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw error;
  }

  const costs = records
    .map((record) => record.apiEquivalentCostMicros)
    .filter((value) => value !== null);
  process.stdout.write(
    `${JSON.stringify({
      source: SOURCE,
      userId,
      recordCount: records.length,
      totalTokens: records.reduce((total, record) => total + record.totalTokens, 0),
      apiEquivalentCostMicros: costs.length === 0 ? null : costs.reduce((total, cost) => total + cost, 0),
      coverageStart:
        records.length === 0 ? null : new Date(Math.min(...records.map((record) => record.observedAt))).toISOString(),
      coverageEnd:
        records.length === 0 ? null : new Date(Math.max(...records.map((record) => record.observedAt))).toISOString(),
      sourceHosts: [...new Set(records.flatMap((record) => record.sourceHosts))].sort(),
      importedAt,
    })}\n`,
  );
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

function openDatabase() {
  const path = resolve(process.env.CODEX_GATEWAY_DB_PATH?.trim() || DEFAULT_DB_PATH);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const database = new DatabaseSync(path);
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA busy_timeout = 5000");
  return database;
}

function ensureSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS usage_historical_records (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      account_scope_id TEXT NOT NULL,
      source TEXT NOT NULL CHECK (source IN ('ccusage_codex')),
      source_record_id TEXT NOT NULL,
      source_fingerprint TEXT NOT NULL,
      source_hosts_json TEXT NOT NULL,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      cached_input_tokens INTEGER NOT NULL DEFAULT 0,
      cache_write_input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      reasoning_output_tokens INTEGER NOT NULL DEFAULT 0,
      api_equivalent_cost_micros INTEGER,
      pricing_version TEXT,
      pricing_completeness TEXT NOT NULL CHECK (pricing_completeness IN ('complete', 'partial', 'unknown')),
      observed_at INTEGER NOT NULL,
      imported_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, account_scope_id, source, source_record_id)
    );
    CREATE INDEX IF NOT EXISTS idx_usage_historical_period
      ON usage_historical_records(user_id, account_scope_id, source, observed_at);
  `);
}

function requestedUserId(input, database) {
  const value = input?.userId;
  const userId = value === undefined ? null : positiveInteger(value);
  const row =
    userId === null
      ? database.prepare("SELECT id FROM users WHERE is_active = 1 ORDER BY id LIMIT 1").get()
      : database
          .prepare("SELECT id FROM users WHERE id = ? AND is_active = 1 LIMIT 1")
          .get(userId);
  const fallback = positiveInteger(row?.id);
  if (fallback === null) throw new Error("No active Gateway user is available for import");
  return fallback;
}

function usageAccountScopeId(userId) {
  const secret = process.env.CODEX_GATEWAY_CONFIG_SECRET?.trim() || "codex-gateway-development-secret";
  return createHmac("sha256", secret)
    .update(`codex-gateway-account-scope:${userId}`)
    .digest("hex");
}

function normalizeRecords(value) {
  if (!Array.isArray(value)) throw new Error("Import payload must contain a records array");
  return value.map((candidate, index) => {
    const record = objectOrNull(candidate);
    if (record === null) throw new Error(`Record ${index} is not an object`);
    const sourceRecordId = boundedString(record.sourceRecordId, "sourceRecordId", 500);
    const sourceFingerprint = boundedString(record.sourceFingerprint, "sourceFingerprint", 200);
    const sourceHosts = Array.isArray(record.sourceHosts)
      ? uniqueStrings(record.sourceHosts)
      : [];
    if (sourceHosts.length === 0) throw new Error(`Record ${index} has no source host`);
    const cost = nullableInteger(record.apiEquivalentCostMicros);
    const completeness = boundedString(record.pricingCompleteness, "pricingCompleteness", 20);
    if (!["complete", "partial", "unknown"].includes(completeness)) {
      throw new Error(`Record ${index} has invalid pricing completeness`);
    }
    return {
      sourceRecordId,
      sourceFingerprint,
      sourceHosts,
      totalTokens: nonNegativeInteger(record.totalTokens, "totalTokens"),
      inputTokens: nonNegativeInteger(record.inputTokens, "inputTokens"),
      cachedInputTokens: nonNegativeInteger(record.cachedInputTokens, "cachedInputTokens"),
      cacheWriteInputTokens: nonNegativeInteger(record.cacheWriteInputTokens, "cacheWriteInputTokens"),
      outputTokens: nonNegativeInteger(record.outputTokens, "outputTokens"),
      reasoningOutputTokens: nonNegativeInteger(record.reasoningOutputTokens, "reasoningOutputTokens"),
      apiEquivalentCostMicros: cost,
      pricingVersion:
        record.pricingVersion === null || record.pricingVersion === undefined
          ? null
          : boundedString(record.pricingVersion, "pricingVersion", 200),
      pricingCompleteness: completeness,
      observedAt: positiveInteger(record.observedAt) ?? (() => {
        throw new Error(`Record ${index} has invalid observedAt`);
      })(),
    };
  });
}

function readStdin() {
  return new Promise((resolvePromise, reject) => {
    let value = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      value += chunk;
      if (value.length > 100 * 1024 * 1024) reject(new Error("Import payload is too large"));
    });
    process.stdin.on("end", () => resolvePromise(value));
    process.stdin.on("error", reject);
  });
}

function objectOrNull(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function boundedString(value, name, maxLength) {
  if (typeof value !== "string" || value.trim() === "" || value.length > maxLength) {
    throw new Error(`Invalid ${name}`);
  }
  return value.trim();
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string").map((value) => value.trim()).filter(Boolean))].sort();
}

function positiveInteger(value) {
  const numberValue = Number(value);
  return Number.isSafeInteger(numberValue) && numberValue > 0 ? numberValue : null;
}

function nonNegativeInteger(value, name) {
  const numberValue = Number(value);
  if (!Number.isSafeInteger(numberValue) || numberValue < 0) throw new Error(`Invalid ${name}`);
  return numberValue;
}

function nullableInteger(value) {
  if (value === null || value === undefined || value === "") return null;
  const numberValue = Number(value);
  if (!Number.isSafeInteger(numberValue) || numberValue < 0) {
    throw new Error("Invalid apiEquivalentCostMicros");
  }
  return numberValue;
}
