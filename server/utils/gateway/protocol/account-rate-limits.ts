import { z } from "zod";
import type { CodexRateLimitSummary, CodexRateLimitWindow } from "~~/shared/types";

const rateLimitWindowSchema = z
  .object({
    usedPercent: z.number(),
    windowDurationMins: z.number().nonnegative().nullable(),
    resetsAt: z.number().nonnegative().nullable(),
  })
  .loose();

const rateLimitSnapshotSchema = z
  .object({
    limitId: z.string().nullable(),
    limitName: z.string().nullable(),
    planType: z.string().nullable(),
    primary: rateLimitWindowSchema.nullable(),
    secondary: rateLimitWindowSchema.nullable(),
  })
  .loose();

const accountRateLimitsResponseSchema = z
  .object({
    rateLimits: rateLimitSnapshotSchema,
    rateLimitsByLimitId: z.record(z.string(), rateLimitSnapshotSchema).nullable(),
  })
  .loose();

export function codexRateLimitSummaryFromResponse(
  hostId: number,
  value: unknown,
): CodexRateLimitSummary {
  const response = accountRateLimitsResponseSchema.parse(value);
  const indexedLimits = response.rateLimitsByLimitId ?? {};
  const snapshot =
    indexedLimits.codex ??
    Object.values(indexedLimits).find((candidate) => candidate.limitId === "codex") ??
    response.rateLimits;

  return {
    hostId,
    limitId: snapshot.limitId,
    limitName: snapshot.limitName,
    planType: snapshot.planType,
    primary: normalizeWindow(snapshot.primary),
    secondary: normalizeWindow(snapshot.secondary),
    observedAt: Date.now(),
  };
}

function normalizeWindow(
  window: z.infer<typeof rateLimitWindowSchema> | null,
): CodexRateLimitWindow | null {
  if (window === null) return null;
  const usedPercent = clampPercent(window.usedPercent);
  return {
    usedPercent,
    remainingPercent: clampPercent(100 - usedPercent),
    windowDurationMins: window.windowDurationMins,
    resetsAt: window.resetsAt,
  };
}

function clampPercent(value: number) {
  return Math.min(100, Math.max(0, Math.round(value)));
}
