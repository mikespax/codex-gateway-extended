export interface TurnTiming {
  startedAt: number | null;
  completedAt: number | null;
  durationMs: number | null;
}

export interface DisplayedTurnTiming extends TurnTiming {
  active: boolean;
}

export function resolvedTurnDurationMs(timing: TurnTiming, nowMs: number) {
  if (timing.durationMs !== null && Number.isFinite(timing.durationMs)) {
    return Math.max(0, timing.durationMs);
  }
  if (timing.startedAt === null || !Number.isFinite(timing.startedAt)) return null;
  const startedAtMs = timing.startedAt * 1000;
  const completedAtMs =
    timing.completedAt === null || !Number.isFinite(timing.completedAt)
      ? nowMs
      : timing.completedAt * 1000;
  return Math.max(0, completedAtMs - startedAtMs);
}
