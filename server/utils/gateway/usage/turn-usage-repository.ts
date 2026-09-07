import { createHmac } from "node:crypto";
import type {
  CodexRateLimitObservation,
  PricingCompleteness,
  UsageDashboardSummary,
  ThreadTurnUsageSummary,
  TokenUsageBreakdown,
  UsageMonthSummary,
  UsagePeriodSummary,
  UsageQuotaSnapshot,
} from "~~/shared/types";
import { threadTurnUsageFromUnknown } from "~~/shared/runtime/usage-accounting";
import { currentGatewayUserId } from "../state/memory";
import { gatewayDatabase, withGatewayDatabaseTransaction } from "../storage/database";
import { recordFromUnknown } from "~~/shared/utils/records";

export type UsageRequestSource = "raw_response" | "cumulative_delta";

export interface UsageRequestInput {
  hostId: number;
  threadId: string;
  turnId: string;
  responseId: string;
  source: UsageRequestSource;
  model: string | null;
  reasoningEffort: string | null;
  serviceTier: string | null;
  usage: TokenUsageBreakdown;
  apiEquivalentCostMicros: number | null;
  pricingVersion: string | null;
  pricingCompleteness: PricingCompleteness;
  observedAt?: number;
}

export interface AggregatedTurnUsage {
  usage: TokenUsageBreakdown;
  model: string | null;
  reasoningEffort: string | null;
  serviceTier: string | null;
  apiEquivalentCostMicros: number | null;
  pricingVersion: string | null;
  pricingCompleteness: PricingCompleteness;
  requestCount: number;
}

const EMPTY_USAGE: TokenUsageBreakdown = {
  totalTokens: 0,
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteInputTokens: 0,
  outputTokens: 0,
  reasoningOutputTokens: 0,
};

export function usageAccountScopeId(userId: number) {
  const secret = process.env.CODEX_GATEWAY_CONFIG_SECRET ?? "codex-gateway-development-secret";
  return createHmac("sha256", secret).update(`codex-gateway-account-scope:${userId}`).digest("hex");
}

export function currentUsageAccountScopeId() {
  const userId = currentGatewayUserId();
  return userId === null ? null : usageAccountScopeId(userId);
}

export class TurnUsageRepository {
  recordRequest(userId: number, input: UsageRequestInput) {
    const accountScopeId = usageAccountScopeId(userId);
    const usage = normalizeUsage(input.usage);
    gatewayDatabase()
      .prepare(
        `INSERT INTO usage_requests (
          user_id, account_scope_id, host_id, thread_id, turn_id, response_id, source,
          model, reasoning_effort, service_tier, total_tokens, input_tokens,
          cached_input_tokens, cache_write_input_tokens, output_tokens, reasoning_output_tokens,
          api_equivalent_cost_micros, pricing_version, pricing_completeness, observed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, account_scope_id, thread_id, response_id) DO NOTHING`,
      )
      .run(
        userId,
        accountScopeId,
        input.hostId,
        input.threadId,
        input.turnId,
        input.responseId,
        input.source,
        input.model,
        input.reasoningEffort,
        input.serviceTier,
        usage.totalTokens,
        usage.inputTokens,
        usage.cachedInputTokens,
        usage.cacheWriteInputTokens,
        usage.outputTokens,
        usage.reasoningOutputTokens,
        input.apiEquivalentCostMicros,
        input.pricingVersion,
        input.pricingCompleteness,
        input.observedAt ?? Date.now(),
      );
  }

  aggregateTurn(userId: number, threadId: string, turnId: string) {
    const accountScopeId = usageAccountScopeId(userId);
    const rows = gatewayDatabase()
      .prepare(
        `SELECT total_tokens, input_tokens, cached_input_tokens, cache_write_input_tokens,
                output_tokens, reasoning_output_tokens, api_equivalent_cost_micros,
                pricing_version, pricing_completeness, model, reasoning_effort, service_tier
         FROM usage_requests
         WHERE user_id = ? AND account_scope_id = ? AND thread_id = ? AND turn_id = ?
         ORDER BY observed_at ASC`,
      )
      .all(userId, accountScopeId, threadId, turnId)
      .map(usageRequestRowFromUnknown);
    if (rows.length === 0) return null;

    const usage = rows.reduce<TokenUsageBreakdown>(
      (total, row) => ({
        totalTokens: total.totalTokens + integer(row.total_tokens),
        inputTokens: total.inputTokens + integer(row.input_tokens),
        cachedInputTokens: total.cachedInputTokens + integer(row.cached_input_tokens),
        cacheWriteInputTokens: total.cacheWriteInputTokens + integer(row.cache_write_input_tokens),
        outputTokens: total.outputTokens + integer(row.output_tokens),
        reasoningOutputTokens: total.reasoningOutputTokens + integer(row.reasoning_output_tokens),
      }),
      { ...EMPTY_USAGE },
    );
    const costs = rows
      .map((row) => numberOrNull(row.api_equivalent_cost_micros))
      .filter((value): value is number => value !== null);
    const completeness = aggregateCompleteness(rows);
    return {
      usage,
      model: latestString(rows, "model"),
      reasoningEffort: latestString(rows, "reasoning_effort"),
      serviceTier: latestString(rows, "service_tier"),
      apiEquivalentCostMicros:
        costs.length === rows.length ? sum(costs) : costs.length ? sum(costs) : null,
      pricingVersion: latestString(rows, "pricing_version"),
      pricingCompleteness: completeness,
      requestCount: rows.length,
    } satisfies AggregatedTurnUsage;
  }

  hasRequest(userId: number, threadId: string, turnId: string, responseId: string) {
    const accountScopeId = usageAccountScopeId(userId);
    const row = gatewayDatabase()
      .prepare(
        `SELECT 1 AS present FROM usage_requests
         WHERE user_id = ? AND account_scope_id = ? AND thread_id = ?
           AND turn_id = ? AND response_id = ? LIMIT 1`,
      )
      .get(userId, accountScopeId, threadId, turnId, responseId);
    return row !== undefined;
  }

  getTurn(userId: number, threadId: string, turnId: string) {
    const accountScopeId = usageAccountScopeId(userId);
    const row = gatewayDatabase()
      .prepare(
        `SELECT * FROM usage_turns
         WHERE user_id = ? AND account_scope_id = ? AND thread_id = ? AND turn_id = ?`,
      )
      .get(userId, accountScopeId, threadId, turnId);
    return row === undefined ? null : mapTurn(row);
  }

  saveTurn(userId: number, summary: ThreadTurnUsageSummary) {
    const accountScopeId = usageAccountScopeId(userId);
    withGatewayDatabaseTransaction((database) => {
      database
        .prepare(
          `INSERT INTO usage_turns (
            user_id, account_scope_id, host_id, thread_id, turn_id, usage_scope, usage_source,
            model, reasoning_effort, service_tier, total_tokens, input_tokens,
            cached_input_tokens, cache_write_input_tokens, output_tokens, reasoning_output_tokens,
            api_equivalent_cost_micros, pricing_version, pricing_completeness,
            provider_estimated_credits_micros, provider_estimated_usd_micros,
            quota_before_json, quota_after_json, quota_deltas_json, quota_attribution_confidence,
            terminal_status, protocol_version, protocol_schema_hash, observed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(user_id, account_scope_id, thread_id, turn_id) DO UPDATE SET
            host_id = excluded.host_id,
            usage_scope = excluded.usage_scope,
            usage_source = excluded.usage_source,
            model = excluded.model,
            reasoning_effort = excluded.reasoning_effort,
            service_tier = excluded.service_tier,
            total_tokens = excluded.total_tokens,
            input_tokens = excluded.input_tokens,
            cached_input_tokens = excluded.cached_input_tokens,
            cache_write_input_tokens = excluded.cache_write_input_tokens,
            output_tokens = excluded.output_tokens,
            reasoning_output_tokens = excluded.reasoning_output_tokens,
            api_equivalent_cost_micros = excluded.api_equivalent_cost_micros,
            pricing_version = excluded.pricing_version,
            pricing_completeness = excluded.pricing_completeness,
            provider_estimated_credits_micros = excluded.provider_estimated_credits_micros,
            provider_estimated_usd_micros = excluded.provider_estimated_usd_micros,
            quota_before_json = excluded.quota_before_json,
            quota_after_json = excluded.quota_after_json,
            quota_deltas_json = excluded.quota_deltas_json,
            quota_attribution_confidence = excluded.quota_attribution_confidence,
            terminal_status = excluded.terminal_status,
            protocol_version = excluded.protocol_version,
            protocol_schema_hash = excluded.protocol_schema_hash,
            observed_at = excluded.observed_at`,
        )
        .run(
          userId,
          accountScopeId,
          summary.hostId,
          summary.threadId,
          summary.turnId,
          summary.usageScope,
          summary.usageSource,
          summary.model,
          summary.reasoningEffort,
          summary.serviceTier,
          summary.totalTokens,
          summary.inputTokens,
          summary.cachedInputTokens,
          summary.cacheWriteInputTokens,
          summary.outputTokens,
          summary.reasoningOutputTokens,
          summary.apiEquivalentCostMicros,
          summary.pricingVersion,
          summary.pricingCompleteness,
          summary.providerEstimatedCreditsMicros,
          summary.providerEstimatedUsdMicros,
          summary.quotaBefore === null ? null : JSON.stringify(summary.quotaBefore),
          summary.quotaAfter === null ? null : JSON.stringify(summary.quotaAfter),
          JSON.stringify(summary.quotaDeltas),
          summary.quotaAttributionConfidence,
          summary.terminalStatus,
          summary.protocolVersion,
          summary.protocolSchemaHash,
          summary.observedAt,
        );
    });
  }

  listThread(userId: number, threadId: string) {
    const accountScopeId = usageAccountScopeId(userId);
    return gatewayDatabase()
      .prepare(
        `SELECT * FROM usage_turns
         WHERE user_id = ? AND account_scope_id = ? AND thread_id = ?
         ORDER BY observed_at ASC, turn_id ASC`,
      )
      .all(userId, accountScopeId, threadId)
      .map((row) => mapTurn(row))
      .filter((row): row is ThreadTurnUsageSummary => row !== null);
  }

  recordQuotaObservation(userId: number, observation: CodexRateLimitObservation) {
    if (observation.windows.length === 0) return;
    const accountScopeId = usageAccountScopeId(userId);
    withGatewayDatabaseTransaction((database) => {
      for (const window of observation.windows) {
        const previous = recordFromUnknown(
          database
            .prepare(
              `SELECT used_percent, remaining_percent, window_duration_mins, resets_at,
                      limit_id, limit_name, plan_type, observed_at
               FROM usage_quota_observations
               WHERE user_id = ? AND account_scope_id = ? AND host_id = ? AND window_key = ?
               ORDER BY observed_at DESC LIMIT 1`,
            )
            .get(userId, accountScopeId, observation.hostId, window.key),
        );
        const observedAt = observation.observedAt;
        const unchanged =
          previous !== null &&
          numberOrNull(previous.used_percent) === window.usedPercent &&
          numberOrNull(previous.remaining_percent) === window.remainingPercent &&
          numberOrNull(previous.window_duration_mins) === window.windowDurationMins &&
          numberOrNull(previous.resets_at) === window.resetsAt &&
          nullableString(previous.limit_id) === observation.limitId &&
          nullableString(previous.limit_name) === observation.limitName &&
          nullableString(previous.plan_type) === observation.planType;
        if (unchanged && observedAt - integer(previous.observed_at) < 300_000) continue;

        database
          .prepare(
            `INSERT INTO usage_quota_observations (
              user_id, account_scope_id, host_id, window_key, used_percent, remaining_percent,
              window_duration_mins, resets_at, limit_id, limit_name, plan_type, observed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            userId,
            accountScopeId,
            observation.hostId,
            window.key,
            window.usedPercent,
            window.remainingPercent,
            window.windowDurationMins,
            window.resetsAt,
            observation.limitId,
            observation.limitName,
            observation.planType,
            observedAt,
          );
      }
    });
  }

  latestQuotaSnapshots(userId: number): UsageQuotaSnapshot[] {
    const accountScopeId = usageAccountScopeId(userId);
    const rows = gatewayDatabase()
      .prepare(
        `SELECT host_id, window_key, used_percent, remaining_percent, window_duration_mins,
                resets_at, limit_id, limit_name, plan_type, observed_at
         FROM usage_quota_observations
         WHERE user_id = ? AND account_scope_id = ?
         ORDER BY observed_at DESC`,
      )
      .all(userId, accountScopeId);
    const latest = new Map<string, UsageQuotaSnapshot>();
    for (const row of rows) {
      const snapshot = quotaSnapshotFromUnknown(row);
      if (snapshot === null || latest.has(snapshot.key)) continue;
      latest.set(snapshot.key, snapshot);
    }
    return Array.from(latest.values()).sort(compareQuotaSnapshots);
  }

  dashboardSummary(userId: number, now = Date.now()): UsageDashboardSummary {
    return {
      generatedAt: now,
      thisMonth: this.monthSummary(userId, now),
      monthly: this.periodSummaries(userId, "month"),
      weekly: this.periodSummaries(userId, "week"),
      quotaWindows: this.latestQuotaSnapshots(userId),
      liveHostCount: 0,
      failedHostCount: 0,
    };
  }

  monthSummary(userId: number, now = Date.now()): UsageMonthSummary {
    const periodStart = usagePeriodStart(now);
    const accountScopeId = usageAccountScopeId(userId);
    const rows = gatewayDatabase()
      .prepare(
        `SELECT api_equivalent_cost_micros FROM usage_turns
         WHERE user_id = ? AND account_scope_id = ? AND usage_scope = 'direct_turn'
           AND observed_at >= ?`,
      )
      .all(userId, accountScopeId, periodStart)
      .map((row) => ({
        api_equivalent_cost_micros: recordFromUnknown(row)?.api_equivalent_cost_micros,
      }));
    const pricedCosts = rows
      .map((row) => numberOrNull(row.api_equivalent_cost_micros))
      .filter((value): value is number => value !== null);
    const apiEquivalentCostMicros = pricedCosts.length === 0 ? null : sum(pricedCosts);
    const subscriptionPriceMicros = configuredSubscriptionPriceMicros();
    return {
      periodStart: new Date(periodStart).toISOString(),
      apiEquivalentCostMicros,
      subscriptionPriceMicros,
      subscriptionPriceSource: subscriptionPriceMicros === null ? "unavailable" : "configured",
      paybackRatio:
        subscriptionPriceMicros === null ||
        subscriptionPriceMicros <= 0 ||
        apiEquivalentCostMicros === null
          ? null
          : apiEquivalentCostMicros / subscriptionPriceMicros,
    };
  }

  private periodSummaries(userId: number, period: "month" | "week"): UsagePeriodSummary[] {
    const accountScopeId = usageAccountScopeId(userId);
    const rows = gatewayDatabase()
      .prepare(
        `SELECT observed_at, total_tokens, api_equivalent_cost_micros
         FROM usage_turns
         WHERE user_id = ? AND account_scope_id = ? AND usage_scope = 'direct_turn'
         ORDER BY observed_at ASC`,
      )
      .all(userId, accountScopeId);
    const buckets = new Map<string, UsagePeriodSummary>();
    for (const row of rows) {
      const record = recordFromUnknown(row);
      if (record === null) continue;
      const periodStart = periodStartFor(integer(record.observed_at), period);
      const existing = buckets.get(periodStart) ?? {
        periodStart,
        periodEnd: periodEndFor(periodStart, period),
        turnCount: 0,
        pricedTurnCount: 0,
        totalTokens: 0,
        apiEquivalentCostMicros: 0,
      };
      existing.turnCount += 1;
      existing.totalTokens += integer(record.total_tokens);
      const cost = numberOrNull(record.api_equivalent_cost_micros);
      if (cost !== null) {
        existing.pricedTurnCount += 1;
        existing.apiEquivalentCostMicros += cost;
      }
      buckets.set(periodStart, existing);
    }
    return Array.from(buckets.values()).sort((left, right) =>
      left.periodStart.localeCompare(right.periodStart),
    );
  }
}

interface UsageRequestRow {
  total_tokens: unknown;
  input_tokens: unknown;
  cached_input_tokens: unknown;
  cache_write_input_tokens: unknown;
  output_tokens: unknown;
  reasoning_output_tokens: unknown;
  api_equivalent_cost_micros: unknown;
  pricing_version: unknown;
  pricing_completeness: unknown;
  model: unknown;
  reasoning_effort: unknown;
  service_tier: unknown;
}

const turnUsageRepository = new TurnUsageRepository();
export { turnUsageRepository };

function mapTurn(row: unknown) {
  const record = recordFromUnknown(row);
  if (record === null) return null;
  const quotaBefore = parseJson(record.quota_before_json);
  const quotaAfter = parseJson(record.quota_after_json);
  const candidate = {
    hostId: integer(record.host_id),
    threadId: string(record.thread_id),
    turnId: string(record.turn_id),
    usageScope: record.usage_scope,
    usageSource: record.usage_source,
    model: nullableString(record.model),
    reasoningEffort: nullableString(record.reasoning_effort),
    serviceTier: nullableString(record.service_tier),
    totalTokens: integer(record.total_tokens),
    inputTokens: integer(record.input_tokens),
    cachedInputTokens: integer(record.cached_input_tokens),
    cacheWriteInputTokens: integer(record.cache_write_input_tokens),
    outputTokens: integer(record.output_tokens),
    reasoningOutputTokens: integer(record.reasoning_output_tokens),
    apiEquivalentCostMicros: numberOrNull(record.api_equivalent_cost_micros),
    pricingVersion: nullableString(record.pricing_version),
    pricingCompleteness: record.pricing_completeness,
    providerEstimatedCreditsMicros: numberOrNull(record.provider_estimated_credits_micros),
    providerEstimatedUsdMicros: numberOrNull(record.provider_estimated_usd_micros),
    quotaBefore,
    quotaAfter,
    quotaDeltas: parseJson(record.quota_deltas_json) ?? [],
    quotaAttributionConfidence: record.quota_attribution_confidence,
    terminalStatus: record.terminal_status ?? null,
    protocolVersion: nullableString(record.protocol_version),
    protocolSchemaHash: nullableString(record.protocol_schema_hash),
    observedAt: integer(record.observed_at),
  };
  return threadTurnUsageFromUnknown(candidate);
}

function aggregateCompleteness(rows: UsageRequestRow[]): PricingCompleteness {
  if (rows.some((row) => row.pricing_completeness === "unknown")) return "unknown";
  if (rows.some((row) => row.pricing_completeness === "partial")) return "partial";
  return "complete";
}

function usageRequestRowFromUnknown(row: unknown): UsageRequestRow {
  const record = recordFromUnknown(row) ?? {};
  return {
    total_tokens: record.total_tokens,
    input_tokens: record.input_tokens,
    cached_input_tokens: record.cached_input_tokens,
    cache_write_input_tokens: record.cache_write_input_tokens,
    output_tokens: record.output_tokens,
    reasoning_output_tokens: record.reasoning_output_tokens,
    api_equivalent_cost_micros: record.api_equivalent_cost_micros,
    pricing_version: record.pricing_version,
    pricing_completeness: record.pricing_completeness,
    model: record.model,
    reasoning_effort: record.reasoning_effort,
    service_tier: record.service_tier,
  };
}

function latestString(rows: UsageRequestRow[], key: keyof UsageRequestRow) {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const value = rows[index]?.[key];
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return null;
}

function normalizeUsage(usage: TokenUsageBreakdown): TokenUsageBreakdown {
  return {
    totalTokens: integer(usage.totalTokens),
    inputTokens: integer(usage.inputTokens),
    cachedInputTokens: integer(usage.cachedInputTokens),
    cacheWriteInputTokens: integer(usage.cacheWriteInputTokens),
    outputTokens: integer(usage.outputTokens),
    reasoningOutputTokens: integer(usage.reasoningOutputTokens),
  };
}

function integer(value: unknown) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? Math.max(0, Math.floor(numberValue)) : 0;
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function string(value: unknown) {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  return "";
}

function nullableString(value: unknown) {
  return typeof value === "string" && value !== "" ? value : null;
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string" || value === "") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function quotaSnapshotFromUnknown(row: unknown): UsageQuotaSnapshot | null {
  const record = recordFromUnknown(row);
  if (record === null || typeof record.window_key !== "string") return null;
  const usedPercent = numberOrNull(record.used_percent);
  const remainingPercent = numberOrNull(record.remaining_percent);
  if (usedPercent === null || remainingPercent === null) return null;
  return {
    hostId: integer(record.host_id),
    hostName: null,
    key: record.window_key,
    usedPercent,
    remainingPercent,
    windowDurationMins: numberOrNull(record.window_duration_mins),
    resetsAt: numberOrNull(record.resets_at),
    limitId: nullableString(record.limit_id),
    limitName: nullableString(record.limit_name),
    planType: nullableString(record.plan_type),
    observedAt: integer(record.observed_at),
    source: "persisted",
  };
}

function compareQuotaSnapshots(left: UsageQuotaSnapshot, right: UsageQuotaSnapshot) {
  const leftDuration = left.windowDurationMins ?? Number.MAX_SAFE_INTEGER;
  const rightDuration = right.windowDurationMins ?? Number.MAX_SAFE_INTEGER;
  return leftDuration - rightDuration || left.key.localeCompare(right.key);
}

function periodStartFor(timestamp: number, period: "month" | "week") {
  const date = new Date(timestamp);
  if (period === "month") {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString();
  }
  const dayOfWeek = date.getUTCDay();
  const daysSinceMonday = (dayOfWeek + 6) % 7;
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - daysSinceMonday),
  ).toISOString();
}

function periodEndFor(periodStart: string, period: "month" | "week") {
  const date = new Date(periodStart);
  if (period === "month") {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)).toISOString();
  }
  return new Date(date.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function usagePeriodStart(now: number) {
  const configured = process.env.CODEX_GATEWAY_USAGE_PERIOD_START?.trim();
  if (configured !== undefined && configured !== "") {
    const timestamp = Date.parse(configured);
    if (Number.isFinite(timestamp)) return timestamp;
  }
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

function configuredSubscriptionPriceMicros() {
  const value = Number(process.env.CODEX_GATEWAY_SUBSCRIPTION_PRICE_USD);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 1_000_000);
}
