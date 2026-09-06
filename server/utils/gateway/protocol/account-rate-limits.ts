import { z } from "zod";
import type {
  CodexRateLimitObservation,
  CodexRateLimitSummary,
  CodexRateLimitWindow,
} from "~~/shared/types";

const rateLimitWindowSchema = z
  .object({
    usedPercent: z.number().nullable().optional(),
    windowDurationMins: z.number().nonnegative().nullable().optional(),
    resetsAt: z.number().nonnegative().nullable().optional(),
  })
  .loose();

const rateLimitSnapshotSchema = z
  .object({
    limitId: z.string().nullable().optional(),
    limitName: z.string().nullable().optional(),
    planType: z.string().nullable().optional(),
    primary: rateLimitWindowSchema.nullish(),
    secondary: rateLimitWindowSchema.nullish(),
  })
  .loose();

const accountRateLimitsResponseSchema = z
  .object({
    rateLimits: rateLimitSnapshotSchema.nullish(),
    rateLimitsByLimitId: z.record(z.string(), rateLimitSnapshotSchema).nullish(),
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
    response.rateLimits ??
    null;
  const windows = collectWindows(indexedLimits, response.rateLimits);

  return {
    hostId,
    limitId: snapshot?.limitId ?? null,
    limitName: snapshot?.limitName ?? null,
    planType: snapshot?.planType ?? null,
    primary: normalizeWindow(snapshot?.primary),
    secondary: normalizeWindow(snapshot?.secondary),
    windows,
    observedAt: Date.now(),
  };
}

export function codexRateLimitObservationFromResponse(
  hostId: number,
  value: unknown,
): CodexRateLimitObservation {
  return codexRateLimitSummaryFromResponse(hostId, value);
}

function normalizeWindow(
  window: z.infer<typeof rateLimitWindowSchema> | null | undefined,
): CodexRateLimitWindow | null {
  if (window === null || window === undefined || window.usedPercent == null) return null;
  const usedPercent = clampPercent(window.usedPercent);
  return {
    usedPercent,
    remainingPercent: clampPercent(100 - usedPercent),
    windowDurationMins: window.windowDurationMins ?? null,
    resetsAt: window.resetsAt ?? null,
  };
}

function clampPercent(value: number) {
  return Math.min(100, Math.max(0, Math.round(value * 100) / 100));
}

function collectWindows(
  indexedLimits: Record<string, z.infer<typeof rateLimitSnapshotSchema>>,
  fallback: z.infer<typeof rateLimitSnapshotSchema> | null | undefined,
) {
  const windows: Array<CodexRateLimitWindow & { key: string }> = [];
  const seen = new Set<string>();
  const candidates = Object.entries(indexedLimits);
  if (candidates.length === 0 && fallback !== undefined && fallback !== null) {
    candidates.push([fallback.limitId ?? "codex", fallback]);
  }
  for (const [limitKey, snapshot] of candidates) {
    for (const [windowKey, value] of [
      ["primary", snapshot.primary],
      ["secondary", snapshot.secondary],
    ] as const) {
      const window = normalizeWindow(value);
      const key = `${limitKey}:${
        window?.windowDurationMins === null || window?.windowDurationMins === undefined
          ? windowKey
          : `${window.windowDurationMins}m`
      }`;
      if (window !== null && !seen.has(key)) {
        seen.add(key);
        windows.push({ key, ...window });
      }
    }
  }
  return windows;
}
