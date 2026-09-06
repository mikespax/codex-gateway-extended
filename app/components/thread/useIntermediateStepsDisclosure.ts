import { reactive, watch, type ComputedRef } from "vue";
import { itemStatusSignature, statusValue } from "./thread-turn-sections";
import type { ThreadTimelineItem } from "~~/shared/types";

interface IntermediateDisclosureTurn {
  id: string;
  status: unknown;
  items: ThreadTimelineItem[];
  turnIsActive: boolean;
  hasPendingApproval: boolean;
}

const TERMINAL_TURN_STATUSES = new Set(["completed", "failed", "interrupted"]);

export function useIntermediateStepsDisclosure(input: {
  turns: ComputedRef<IntermediateDisclosureTurn[]>;
  threadIsRunning: ComputedRef<boolean>;
}) {
  // Disclosure state belongs to the timeline, not to virtual row components. Rows are destroyed
  // offscreen, so keeping this small per-turn map here preserves explicit user choices without
  // coupling expansion to virtualizer measurements or a global store.
  const openByTurnId = reactive(new Map<string, boolean>());
  const touchedByUser = new Set<string>();

  watch(
    () => [
      input.threadIsRunning.value,
      ...input.turns.value.flatMap((turn) => [
        turn.id,
        statusValue(turn.status),
        ...itemStatusSignature(turn.items),
      ]),
    ],
    () => {
      const liveTurnIds = new Set(input.turns.value.map((turn) => turn.id));
      for (const turnId of openByTurnId.keys()) {
        if (!liveTurnIds.has(turnId)) {
          openByTurnId.delete(turnId);
          touchedByUser.delete(turnId);
        }
      }

      for (const turn of input.turns.value) {
        // A rollout created before the Gateway full-access invariant may still have one
        // in-flight approval request. Keep that exception visible so an old turn cannot appear
        // frozen behind a collapsed Working row. New turns never create this state because every
        // Gateway start/resume/settings request forces approvalPolicy=never.
        if (turn.hasPendingApproval && !touchedByUser.has(turn.id)) {
          openByTurnId.set(turn.id, true);
          continue;
        }
        // Active turns open as soon as their first intermediate item arrives. Once the turn has a
        // terminal status, collapse it automatically so a completed transcript stays compact.
        // Preserve an explicit open/closed choice across both transitions, including a reader who
        // deliberately keeps a completed trace open for inspection.
        if (turn.turnIsActive || !TERMINAL_TURN_STATUSES.has(statusValue(turn.status) ?? "")) {
          if (!touchedByUser.has(turn.id)) openByTurnId.set(turn.id, true);
          continue;
        }
        if (!touchedByUser.has(turn.id)) openByTurnId.set(turn.id, false);
      }
    },
    { immediate: true },
  );

  function isIntermediateOpen(turnId: string) {
    return openByTurnId.get(turnId) ?? false;
  }

  function setIntermediateOpen(turnId: string, open: boolean) {
    touchedByUser.add(turnId);
    openByTurnId.set(turnId, open);
  }

  return {
    isIntermediateOpen,
    setIntermediateOpen,
  };
}
