import type { ComposerTurnOptions } from "~~/shared/types";
import type { ThreadHistoryTurn } from "~~/shared/thread-history/types";
import type { AppServerTurnDisplayError } from "@/stores/gateway/errors";
import { useGatewayTranslator } from "@/composables/i18n/useGatewayTranslator";
import { interruptActiveTurn, interruptThreadTurn } from "./interrupt";
import { loadOlderTurns } from "./older-turns";
import { maybeQueueServerOverloadedRetry, maybeRetryAfterTurnFailure } from "./retry";
import { flushQueuedTurn, sendTurn, steerQueuedTurn, type TurnDispatchOptions } from "./submission";
import { respondToServerRequest } from "./transport";

export function createGatewayThreadTurnActions() {
  const t = useGatewayTranslator();
  return {
    sendTurn: (text: string, options?: ComposerTurnOptions, dispatch?: TurnDispatchOptions) =>
      sendTurn(t, text, options, dispatch),
    flushQueuedTurn: (hostId: number, threadId: string) => flushQueuedTurn(t, hostId, threadId),
    steerQueuedTurn: (hostId: number, threadId: string, queuedId: string) =>
      steerQueuedTurn(t, hostId, threadId, queuedId),
    loadOlderTurns: (options?: { limit?: number }) => loadOlderTurns(t, options),
    interruptActiveTurn: () => interruptActiveTurn(t),
    interruptThreadTurn: (input: { hostId: number; threadId: string; projectId?: number | null }) =>
      interruptThreadTurn(t, input),
    respondToServerRequest,
    maybeQueueServerOverloadedRetry: (
      hostId: number,
      threadId: string,
      turnId: string,
      error: AppServerTurnDisplayError,
    ) => maybeQueueServerOverloadedRetry(t, hostId, threadId, turnId, error),
    maybeRetryAfterTurnFailure: (hostId: number, threadId: string, turn: ThreadHistoryTurn) =>
      maybeRetryAfterTurnFailure(t, hostId, threadId, turn),
  };
}
