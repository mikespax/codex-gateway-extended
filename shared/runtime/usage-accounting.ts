import { z } from "zod";
import type { ThreadTurnUsageSummary } from "../types/account-usage";

const rateLimitWindowSchema = z
  .object({
    usedPercent: z.number().min(0).max(100),
    remainingPercent: z.number().min(0).max(100),
    windowDurationMins: z.number().int().nonnegative().nullable(),
    resetsAt: z.number().int().nonnegative().nullable(),
  })
  .strict();

const rateLimitObservationSchema = z
  .object({
    hostId: z.number().int().positive(),
    limitId: z.string().nullable(),
    limitName: z.string().nullable(),
    planType: z.string().nullable(),
    primary: rateLimitWindowSchema.nullable(),
    secondary: rateLimitWindowSchema.nullable(),
    windows: z.array(rateLimitWindowSchema.extend({ key: z.string().min(1) })),
    observedAt: z.number().int().nonnegative(),
  })
  .strict();

const quotaDeltaSchema = z
  .object({
    key: z.string().min(1),
    windowDurationMins: z.number().int().nonnegative().nullable(),
    beforeUsedPercent: z.number().min(0).max(100).nullable(),
    afterUsedPercent: z.number().min(0).max(100).nullable(),
    deltaPercent: z.number().nullable(),
    resetObserved: z.boolean(),
  })
  .strict();

export const threadTurnUsageSummarySchema = z
  .object({
    hostId: z.number().int().positive(),
    threadId: z.string().min(1),
    turnId: z.string().min(1),
    usageScope: z.enum(["direct_turn", "inclusive_descendants"]),
    usageSource: z.enum([
      "raw_responses",
      "cumulative_delta",
      "provider_thread_delta",
      "unavailable",
    ]),
    model: z.string().nullable(),
    reasoningEffort: z.string().nullable(),
    serviceTier: z.string().nullable(),
    totalTokens: z.number().int().nonnegative(),
    inputTokens: z.number().int().nonnegative(),
    cachedInputTokens: z.number().int().nonnegative(),
    cacheWriteInputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    reasoningOutputTokens: z.number().int().nonnegative(),
    apiEquivalentCostMicros: z.number().int().nonnegative().nullable(),
    pricingVersion: z.string().nullable(),
    pricingCompleteness: z.enum(["complete", "partial", "unknown"]),
    providerEstimatedCreditsMicros: z.number().int().nonnegative().nullable(),
    providerEstimatedUsdMicros: z.number().int().nonnegative().nullable(),
    quotaBefore: rateLimitObservationSchema.nullable(),
    quotaAfter: rateLimitObservationSchema.nullable(),
    quotaDeltas: z.array(quotaDeltaSchema),
    quotaAttributionConfidence: z.enum([
      "account_observation",
      "reset_between_snapshots",
      "unavailable",
    ]),
    terminalStatus: z.enum(["completed", "failed", "interrupted"]).nullable(),
    protocolVersion: z.string().nullable(),
    protocolSchemaHash: z.string().nullable(),
    observedAt: z.number().int().nonnegative(),
  })
  .strict();

export function threadTurnUsageFromUnknown(value: unknown): ThreadTurnUsageSummary | null {
  const result = threadTurnUsageSummarySchema.safeParse(value);
  return result.success ? result.data : null;
}
