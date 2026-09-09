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

export function useIntermediateStepsDisclosure(input: {
  turns: ComputedRef<IntermediateDisclosureTurn[]>;
  threadIsRunning: ComputedRef<boolean>;
}) {
  // Disclosure state belongs to the timeline, not to virtual row components. Rows are destroyed
  // offscreen, so keeping this small per-turn map here preserves explicit user choices without
  // coupling expansion to virtualizer measurements or a global store.
  const openByTurnId = reactive(new Map<string, boolean>());
  const touchedByUser = new Set<string>();
  const wasActiveByTurnId = new Map<string, boolean>();

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
          wasActiveByTurnId.delete(turnId);
        }
      }

      for (const turn of input.turns.value) {
        const wasActive = wasActiveByTurnId.get(turn.id) ?? false;
        const ended = wasActive && !turn.turnIsActive;

        // A turn that just ended always returns to the compact history view. This deliberately
        // clears a temporary live-turn choice so a reader who collapsed or expanded the stream
        // while it was running does not leave a completed transcript permanently expanded.
        if (ended) {
          touchedByUser.delete(turn.id);
          openByTurnId.set(turn.id, false);
        }

        // A rollout created before the Gateway full-access invariant may still have one
        // in-flight approval request. Keep that exception visible so an old turn cannot appear
        // frozen behind a collapsed Working row. New turns never create this state because every
        // Gateway start/resume/settings request forces approvalPolicy=never.
        // Live work starts expanded so the user can follow the turn as it happens. The arrow can
        // still be used to hide or reveal the stream during execution; completion above then
        // returns it to the compact history state. Completed and stale turns start closed.
        if (!ended && turn.hasPendingApproval && !touchedByUser.has(turn.id)) {
          openByTurnId.set(turn.id, true);
        } else if (!ended && turn.turnIsActive && !touchedByUser.has(turn.id)) {
          openByTurnId.set(turn.id, true);
        } else if (!ended && !turn.turnIsActive && !touchedByUser.has(turn.id)) {
          openByTurnId.set(turn.id, false);
        }
        wasActiveByTurnId.set(turn.id, turn.turnIsActive);
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
