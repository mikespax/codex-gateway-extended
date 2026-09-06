import type { ThreadTimelineTurn } from "~~/shared/types";

export function subAgentOwnedTurns(
  thread: { createdAt: number } | null,
  turns: ThreadTimelineTurn[],
  parentTurns: ThreadTimelineTurn[] = [],
): ThreadTimelineTurn[] {
  const threadCreatedAt = timestampMs(thread?.createdAt);
  if (threadCreatedAt === null) return turns;
  const firstOwnedTurnIndex = turns.findIndex((turn) => {
    const startedAt = timestampMs(turn.startedAt);
    return startedAt !== null && startedAt >= threadCreatedAt;
  });
  if (firstOwnedTurnIndex < 0) {
    if (parentTurns.length > 0) {
      const parentTurnIds = new Set(parentTurns.map((turn) => String(turn.id)));
      const parentItemIds = new Set(
        parentTurns.flatMap((turn) => (turn.items ?? []).map((item) => String(item.id))),
      );
      return turns.flatMap((turn) => {
        if (!parentTurnIds.has(String(turn.id))) return [turn];
        const ownedItems = turn.items.filter((item) => !parentItemIds.has(String(item.id)));
        return ownedItems.length > 0 ? [{ ...turn, items: ownedItems }] : [];
      });
    }
    // Upstream permits startedAt:null. If the parent snapshot is unavailable there is no honest
    // fork boundary; rendering the full prefix would reintroduce inherited parent history. The
    // latest turn remains the least lossy safe fallback until the parent or timestamps arrive.
    return turns.slice(-1);
  }
  // Forked histories contain parent turns before the fork boundary. Once the first owned turn is
  // found, retain subsequent untimestamped active updates; never retain an ambiguous untimestamped
  // prefix, because it is indistinguishable from inherited parent history.
  return turns.slice(firstOwnedTurnIndex);
}

function timestampMs(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 10_000_000_000 ? value * 1000 : value;
  }
  if (typeof value !== "string" || !value) return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}
