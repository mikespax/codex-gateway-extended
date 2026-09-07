import type {
  CodexRateLimitObservation,
  GatewayEvent,
  ThreadSettingsState,
  ThreadTurnUsageSummary,
  TokenUsageBreakdown,
} from "~~/shared/types";
import { normalizeTokenUsageBreakdown } from "~~/shared/token-usage";
import { threadSettingsFromAppServer } from "~~/shared/runtime/app-server";
import { terminalTurnStatus } from "~~/shared/thread-runtime-status";
import { idFromUnknown, recordFromUnknown, stringFromUnknown } from "~~/shared/utils/records";
import { estimateApiEquivalentCost, normalizePricingModel } from "~~/shared/usage-pricing";
import { codexRateLimitObservationFromResponse } from "../protocol/account-rate-limits";
import { gatewayEventStore } from "../state/gateway-events";
import { currentGatewayUserId } from "../state/memory";
import {
  turnUsageRepository,
  type AggregatedTurnUsage,
  type UsageRequestInput,
} from "./turn-usage-repository";

export type RateLimitsResolver = () => Promise<unknown>;

export interface TurnUsageObservationOptions {
  resolveRateLimits?: RateLimitsResolver;
  protocolVersion?: string | null;
  protocolSchemaHash?: string | null;
}

interface TurnState {
  userId: number;
  hostId: number;
  threadId: string;
  turnId: string;
  model: string | null;
  reasoningEffort: string | null;
  serviceTier: string | null;
  cumulativeBefore: TokenUsageBreakdown | null;
  cumulativeAfter: TokenUsageBreakdown | null;
  quotaBefore: Promise<CodexRateLimitObservation | null>;
  resolveRateLimits?: RateLimitsResolver;
  protocolVersion: string | null;
  protocolSchemaHash: string | null;
  finalized: boolean;
}

class TurnUsageAccounting {
  private readonly turns = new Map<string, TurnState>();
  private readonly threadSettings = new Map<string, ThreadSettingsState>();

  async observeEvent(event: GatewayEvent, options: TurnUsageObservationOptions = {}) {
    const userId = currentGatewayUserId();
    if (userId === null) return null;
    if (event.method === "gateway/usage/turn") return null;

    const params = recordFromUnknown(event.payload.params) ?? {};
    if (event.method === "thread/settings/updated") {
      this.recordThreadSettings(userId, event.hostId, event.threadId, params);
      return null;
    }

    if (event.method === "turn/started") {
      const turnId = turnIdFromParams(params);
      if (turnId === null) return null;
      this.ensureTurn(userId, event.hostId, event.threadId, turnId, options, {
        ...params,
        __turnStarted: true,
        __eventId: event.id,
      });
      return null;
    }

    if (event.method === "thread/tokenUsage/updated") {
      const turnId = turnIdFromParams(params);
      if (turnId === null) return null;
      const state = this.ensureTurn(userId, event.hostId, event.threadId, turnId, options, params);
      const tokenUsage = recordFromUnknown(params.tokenUsage);
      const cumulative = normalizeTokenUsageBreakdown(tokenUsage?.total);
      if (cumulative === null) return null;
      if (
        state.cumulativeAfter === null ||
        !cumulativeUsageRegressed(cumulative, state.cumulativeAfter)
      ) {
        state.cumulativeAfter = cumulative;
      }
      // Some app-server versions publish the cumulative notification after turn/completed. The
      // turn projection starts as unavailable in that case, so reconcile it once the late event
      // arrives. Raw Responses events remain the preferred source when available.
      if (
        state.finalized &&
        turnUsageRepository.aggregateTurn(userId, event.threadId, turnId) === null
      ) {
        this.recordCumulativeFallback(userId, state);
        this.refreshFinalizedTurn(userId, state);
      }
      return null;
    }

    if (event.method === "rawResponse/completed") {
      await this.recordRawResponse(userId, event, params, options);
      return null;
    }

    if (event.method !== "turn/completed") return null;
    const turnId = turnIdFromParams(params);
    if (turnId === null) return null;
    return this.finalizeTurn(userId, event, turnId, params, options);
  }

  registerTurnMetadata(
    hostId: number,
    threadId: string,
    turnId: string,
    metadata: Pick<ThreadSettingsState, "model" | "effort" | "serviceTier">,
  ) {
    const userId = currentGatewayUserId();
    if (userId === null || turnId.trim() === "") return;
    const state = this.ensureTurn(userId, hostId, threadId, turnId, {}, {});
    if (metadata.model !== null && metadata.model !== undefined && metadata.model.trim() !== "") {
      state.model = metadata.model.trim();
    }
    if (
      metadata.effort !== null &&
      metadata.effort !== undefined &&
      metadata.effort.trim() !== ""
    ) {
      state.reasoningEffort = metadata.effort.trim();
    }
    if (
      metadata.serviceTier !== null &&
      metadata.serviceTier !== undefined &&
      metadata.serviceTier.trim() !== ""
    ) {
      state.serviceTier = metadata.serviceTier.trim();
    }
  }

  private ensureTurn(
    userId: number,
    hostId: number,
    threadId: string,
    turnId: string,
    options: TurnUsageObservationOptions,
    params: Record<string, unknown>,
  ) {
    const key = turnKey(userId, hostId, threadId, turnId);
    const existing = this.turns.get(key);
    if (existing !== undefined) {
      this.updateProtocol(existing, options);
      this.updateMetadata(existing, params, this.settingsFor(userId, hostId, threadId));
      if (params.__turnStarted === true && existing.cumulativeBefore === null) {
        existing.cumulativeBefore = latestCumulativeUsage(hostId, threadId, params.__eventId);
        existing.quotaBefore = readQuota(hostId, options.resolveRateLimits);
        existing.resolveRateLimits = options.resolveRateLimits ?? existing.resolveRateLimits;
      }
      return existing;
    }
    const settings = this.settingsFor(userId, hostId, threadId);
    const state: TurnState = {
      userId,
      hostId,
      threadId,
      turnId,
      model: stringOrNull(params.model) ?? settings?.model ?? null,
      reasoningEffort:
        stringOrNull(params.effort) ?? settings?.effort ?? stringOrNull(params.reasoningEffort),
      serviceTier: stringOrNull(params.serviceTier) ?? settings?.serviceTier ?? null,
      cumulativeBefore: null,
      cumulativeAfter: null,
      quotaBefore: Promise.resolve(null),
      resolveRateLimits: options.resolveRateLimits,
      protocolVersion: options.protocolVersion ?? null,
      protocolSchemaHash: options.protocolSchemaHash ?? null,
      finalized: false,
    };
    this.turns.set(key, state);
    this.updateMetadata(state, params, settings);
    if (params.__turnStarted === true) {
      state.cumulativeBefore = latestCumulativeUsage(hostId, threadId, params.__eventId);
      state.quotaBefore = readQuota(hostId, options.resolveRateLimits);
    }
    return state;
  }

  private recordThreadSettings(
    userId: number,
    hostId: number,
    threadId: string,
    params: Record<string, unknown>,
  ) {
    const settings = threadSettingsFromAppServer(params.threadSettings);
    if (settings !== null) this.threadSettings.set(threadKey(userId, hostId, threadId), settings);
  }

  private settingsFor(userId: number, hostId: number, threadId: string) {
    return this.threadSettings.get(threadKey(userId, hostId, threadId));
  }

  private updateMetadata(
    state: TurnState,
    params: Record<string, unknown>,
    settings: ThreadSettingsState | undefined,
  ) {
    state.model = stringOrNull(params.model) ?? state.model ?? settings?.model ?? null;
    state.reasoningEffort =
      stringOrNull(params.effort) ??
      stringOrNull(params.reasoningEffort) ??
      state.reasoningEffort ??
      settings?.effort ??
      null;
    state.serviceTier =
      stringOrNull(params.serviceTier) ?? state.serviceTier ?? settings?.serviceTier ?? null;
  }

  private updateProtocol(state: TurnState, options: TurnUsageObservationOptions) {
    state.protocolVersion = options.protocolVersion ?? state.protocolVersion;
    state.protocolSchemaHash = options.protocolSchemaHash ?? state.protocolSchemaHash;
    if (options.resolveRateLimits !== undefined)
      state.resolveRateLimits = options.resolveRateLimits;
  }

  private async recordRawResponse(
    userId: number,
    event: GatewayEvent,
    params: Record<string, unknown>,
    options: TurnUsageObservationOptions,
  ) {
    const turnId = turnIdFromParams(params);
    const responseId = stringOrNull(params.responseId);
    if (turnId === null || responseId === null) return;
    const state = this.ensureTurn(userId, event.hostId, event.threadId, turnId, options, params);
    const usage = rawUsageFromUnknown(params.usage);
    if (usage === null) return;
    this.updateProtocol(state, options);
    const request = requestFromUsage(state, usage, responseId, "raw_response");
    turnUsageRepository.recordRequest(userId, request);

    // A delayed raw event can arrive after turn/completed. Reconcile the durable projection in
    // place; the original quota/status evidence remains unchanged.
    if (state.finalized) this.refreshFinalizedTurn(userId, state);
  }

  private async finalizeTurn(
    userId: number,
    event: GatewayEvent,
    turnId: string,
    params: Record<string, unknown>,
    options: TurnUsageObservationOptions,
  ): Promise<ThreadTurnUsageSummary | null> {
    const state = this.ensureTurn(
      userId,
      event.hostId,
      event.threadId,
      turnId,
      { ...options, resolveRateLimits: options.resolveRateLimits },
      params,
    );
    if (state.finalized) return null;
    const existing = turnUsageRepository.getTurn(userId, event.threadId, turnId);
    if (existing !== null) {
      state.finalized = true;
      return null;
    }
    state.finalized = true;
    this.updateProtocol(state, options);
    const quotaBefore = await state.quotaBefore;
    const quotaAfter = await readQuota(event.hostId, state.resolveRateLimits);
    const aggregate = turnUsageRepository.aggregateTurn(userId, event.threadId, turnId);
    const effectiveUsage = aggregate ?? this.recordCumulativeFallback(userId, state);
    const terminalStatus = terminalStatusFromParams(params);
    const quota = quotaResult(quotaBefore, quotaAfter);
    const summary = buildSummary(state, effectiveUsage, terminalStatus, quota);
    turnUsageRepository.saveTurn(userId, summary);
    return summary;
  }

  private recordCumulativeFallback(userId: number, state: TurnState): AggregatedTurnUsage | null {
    const finalUsage = state.cumulativeAfter ?? latestCumulativeUsage(state.hostId, state.threadId);
    if (finalUsage === null || state.cumulativeBefore === null) return null;
    if (cumulativeUsageRegressed(finalUsage, state.cumulativeBefore)) return null;
    const responseId = `cumulative:${state.turnId}`;
    if (turnUsageRepository.hasRequest(userId, state.threadId, state.turnId, responseId)) {
      return turnUsageRepository.aggregateTurn(userId, state.threadId, state.turnId);
    }
    const usage = subtractUsage(finalUsage, state.cumulativeBefore);
    const request = requestFromUsage(
      state,
      usage,
      responseId,
      "cumulative_delta",
    );
    turnUsageRepository.recordRequest(userId, request);
    return turnUsageRepository.aggregateTurn(userId, state.threadId, state.turnId);
  }

  private refreshFinalizedTurn(userId: number, state: TurnState) {
    const current = turnUsageRepository.getTurn(userId, state.threadId, state.turnId);
    const aggregate = turnUsageRepository.aggregateTurn(userId, state.threadId, state.turnId);
    if (current === null || aggregate === null) return;
    const updated = buildSummary(
      state,
      aggregate,
      current.terminalStatus,
      {
        before: current.quotaBefore,
        after: current.quotaAfter,
        deltas: current.quotaDeltas,
        confidence: current.quotaAttributionConfidence,
      },
      current.observedAt,
    );
    turnUsageRepository.saveTurn(userId, updated);
  }
}

function buildSummary(
  state: TurnState,
  aggregate: AggregatedTurnUsage | null,
  terminalStatus: ThreadTurnUsageSummary["terminalStatus"],
  quota: QuotaResult,
  observedAt = Date.now(),
): ThreadTurnUsageSummary {
  const usage = aggregate?.usage ?? zeroUsage();
  const pricing =
    aggregate === null
      ? { costMicros: null, pricingVersion: null, completeness: "unknown" as const }
      : estimateApiEquivalentCost({
          model: state.model ?? aggregate.model,
          serviceTier: state.serviceTier ?? aggregate.serviceTier,
          usage,
        });
  const costMicros = aggregate?.apiEquivalentCostMicros ?? pricing.costMicros;
  const completeness = aggregate?.pricingCompleteness ?? pricing.completeness;
  return {
    hostId: state.hostId,
    threadId: state.threadId,
    turnId: state.turnId,
    usageScope: "direct_turn",
    usageSource:
      aggregate === null
        ? "unavailable"
        : aggregate.requestCount > 0
          ? sourceForAggregate(state, aggregate)
          : "unavailable",
    model: state.model ?? aggregate?.model ?? null,
    reasoningEffort: state.reasoningEffort ?? aggregate?.reasoningEffort ?? null,
    serviceTier: state.serviceTier ?? aggregate?.serviceTier ?? null,
    totalTokens: usage.totalTokens,
    inputTokens: usage.inputTokens,
    cachedInputTokens: usage.cachedInputTokens,
    cacheWriteInputTokens: usage.cacheWriteInputTokens,
    outputTokens: usage.outputTokens,
    reasoningOutputTokens: usage.reasoningOutputTokens,
    apiEquivalentCostMicros: costMicros,
    pricingVersion: aggregate?.pricingVersion ?? pricing.pricingVersion,
    pricingCompleteness: completeness,
    providerEstimatedCreditsMicros: null,
    providerEstimatedUsdMicros: null,
    quotaBefore: quota.before,
    quotaAfter: quota.after,
    quotaDeltas: quota.deltas,
    quotaAttributionConfidence: quota.confidence,
    terminalStatus,
    protocolVersion: state.protocolVersion,
    protocolSchemaHash: state.protocolSchemaHash,
    observedAt,
  };
}

function sourceForAggregate(
  state: TurnState,
  aggregate: AggregatedTurnUsage,
): ThreadTurnUsageSummary["usageSource"] {
  // A cumulative fallback is recorded using a deterministic response id and is the only source
  // when no upstream raw completion was seen. The aggregate's request count is sufficient here
  // because the state has no separate provider ledger.
  const fallback = turnUsageRepository.hasRequest(
    state.userId,
    state.threadId,
    state.turnId,
    `cumulative:${state.turnId}`,
  );
  return fallback && aggregate.requestCount === 1 ? "cumulative_delta" : "raw_responses";
}

function requestFromUsage(
  state: TurnState,
  usage: TokenUsageBreakdown,
  responseId: string,
  source: UsageRequestInput["source"],
): UsageRequestInput {
  const pricing = estimateApiEquivalentCost({
    model: normalizePricingModel(state.model),
    serviceTier: state.serviceTier,
    usage,
  });
  return {
    hostId: state.hostId,
    threadId: state.threadId,
    turnId: state.turnId,
    responseId,
    source,
    model: state.model,
    reasoningEffort: state.reasoningEffort,
    serviceTier: state.serviceTier,
    usage,
    apiEquivalentCostMicros: pricing.costMicros,
    pricingVersion: pricing.pricingVersion,
    pricingCompleteness: pricing.completeness,
  };
}

function readQuota(hostId: number, resolver: RateLimitsResolver | undefined) {
  if (resolver === undefined) return Promise.resolve(null);
  return Promise.resolve()
    .then(() => resolver())
    .then((value) => codexRateLimitObservationFromResponse(hostId, value))
    .catch(() => null);
}

interface QuotaResult {
  before: CodexRateLimitObservation | null;
  after: CodexRateLimitObservation | null;
  deltas: ThreadTurnUsageSummary["quotaDeltas"];
  confidence: ThreadTurnUsageSummary["quotaAttributionConfidence"];
}

function quotaResult(
  before: CodexRateLimitObservation | null,
  after: CodexRateLimitObservation | null,
): QuotaResult {
  if (before === null || after === null) {
    return { before, after, deltas: [], confidence: "unavailable" };
  }
  const beforeByKey = new Map(before.windows.map((window) => [window.key, window]));
  const afterByKey = new Map(after.windows.map((window) => [window.key, window]));
  const keys = new Set([...beforeByKey.keys(), ...afterByKey.keys()]);
  const deltas = [...keys].sort().map((key) => {
    const previous = beforeByKey.get(key);
    const current = afterByKey.get(key);
    const resetObserved =
      previous !== undefined && current !== undefined && current.usedPercent < previous.usedPercent;
    return {
      key,
      windowDurationMins: current?.windowDurationMins ?? previous?.windowDurationMins ?? null,
      beforeUsedPercent: previous?.usedPercent ?? null,
      afterUsedPercent: current?.usedPercent ?? null,
      deltaPercent:
        previous !== undefined && current !== undefined && !resetObserved
          ? roundPercent(current.usedPercent - previous.usedPercent)
          : null,
      resetObserved,
    };
  });
  const reset = deltas.some((delta) => delta.resetObserved);
  return {
    before,
    after,
    deltas,
    confidence: reset ? "reset_between_snapshots" : "account_observation",
  };
}

function latestCumulativeUsage(hostId: number, threadId: string, beforeEventId?: unknown) {
  const before = typeof beforeEventId === "number" ? beforeEventId : Number(beforeEventId);
  const events = gatewayEventStore
    .list(hostId, threadId, 0, 500)
    .filter((event) => !Number.isFinite(before) || event.id < before)
    .sort((left, right) => right.id - left.id);
  for (const event of events) {
    if (event.method !== "thread/tokenUsage/updated") continue;
    const params = recordFromUnknown(event.payload.params);
    const tokenUsage = recordFromUnknown(params?.tokenUsage);
    const total = normalizeTokenUsageBreakdown(tokenUsage?.total);
    if (total !== null) return total;
  }
  return null;
}

function rawUsageFromUnknown(value: unknown) {
  const usage = recordFromUnknown(value);
  if (usage === null) return null;
  const normalized = normalizeTokenUsageBreakdown(usage);
  if (normalized !== null) return normalized;
  const mapped = {
    totalTokens: usage.totalTokens ?? usage.total_tokens,
    inputTokens: usage.inputTokens ?? usage.input_tokens,
    cachedInputTokens: usage.cachedInputTokens ?? usage.cached_input_tokens ?? 0,
    cacheWriteInputTokens: usage.cacheWriteInputTokens ?? usage.cache_write_input_tokens ?? 0,
    outputTokens: usage.outputTokens ?? usage.output_tokens,
    reasoningOutputTokens: usage.reasoningOutputTokens ?? usage.reasoning_output_tokens ?? 0,
  };
  const inputTokens = Number(mapped.inputTokens);
  const outputTokens = Number(mapped.outputTokens);
  if (mapped.totalTokens == null && Number.isFinite(inputTokens) && Number.isFinite(outputTokens)) {
    mapped.totalTokens = inputTokens + outputTokens;
  }
  return normalizeTokenUsageBreakdown(mapped);
}

function subtractUsage(finalUsage: TokenUsageBreakdown, beforeUsage: TokenUsageBreakdown) {
  return {
    totalTokens: difference(finalUsage.totalTokens, beforeUsage.totalTokens),
    inputTokens: difference(finalUsage.inputTokens, beforeUsage.inputTokens),
    cachedInputTokens: difference(finalUsage.cachedInputTokens, beforeUsage.cachedInputTokens),
    cacheWriteInputTokens: difference(
      finalUsage.cacheWriteInputTokens,
      beforeUsage.cacheWriteInputTokens,
    ),
    outputTokens: difference(finalUsage.outputTokens, beforeUsage.outputTokens),
    reasoningOutputTokens: difference(
      finalUsage.reasoningOutputTokens,
      beforeUsage.reasoningOutputTokens,
    ),
  } satisfies TokenUsageBreakdown;
}

function difference(after: number, before: number) {
  return Math.max(0, Math.floor(after) - Math.floor(before));
}

function cumulativeUsageRegressed(after: TokenUsageBreakdown, before: TokenUsageBreakdown) {
  return (
    after.totalTokens < before.totalTokens ||
    after.inputTokens < before.inputTokens ||
    after.cachedInputTokens < before.cachedInputTokens ||
    after.cacheWriteInputTokens < before.cacheWriteInputTokens ||
    after.outputTokens < before.outputTokens ||
    after.reasoningOutputTokens < before.reasoningOutputTokens
  );
}

function zeroUsage(): TokenUsageBreakdown {
  return {
    totalTokens: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
  };
}

function turnIdFromParams(params: Record<string, unknown>) {
  const turn = recordFromUnknown(params.turn);
  const id =
    idFromUnknown(params.turnId) ?? idFromUnknown(params.turn_id) ?? idFromUnknown(turn?.id);
  return id === null ? null : String(id);
}

function terminalStatusFromParams(
  params: Record<string, unknown>,
): ThreadTurnUsageSummary["terminalStatus"] {
  const turn = recordFromUnknown(params.turn);
  const status = stringFromUnknown(turn?.status) ?? stringFromUnknown(params.status);
  if (status === "failed") return "failed";
  if (status === "interrupted") return "interrupted";
  return terminalTurnStatus(status) === "failed"
    ? "failed"
    : terminalTurnStatus(status) === "interrupted"
      ? "interrupted"
      : "completed";
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function roundPercent(value: number) {
  return Math.round(value * 100) / 100;
}

function turnKey(userId: number, hostId: number, threadId: string, turnId: string) {
  return `${userId}:${hostId}:${threadId}:${turnId}`;
}

function threadKey(userId: number, hostId: number, threadId: string) {
  return `${userId}:${hostId}:${threadId}`;
}

export const turnUsageAccounting = new TurnUsageAccounting();
