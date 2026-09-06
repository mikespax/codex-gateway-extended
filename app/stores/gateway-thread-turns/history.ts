import {
  insertSteerItemIntoActiveTurn,
  mergeItemIntoLatestTurn,
} from "~~/shared/thread-history/items";
import { mergeThreadTurns } from "~~/shared/thread-history/turns";
import type {
  ThreadHistoryItem,
  ThreadHistorySeed,
  ThreadHistoryState,
  ThreadHistoryTurn,
} from "~~/shared/thread-history/types";
import { useGatewayNavigationStore } from "@/stores/gateway-navigation";
import { useGatewayThreadViewStore } from "@/stores/gateway-thread-view";
import { cacheSelectedThreadView } from "@/stores/gateway/thread-open/view-state";
import {
  patchThreadView,
  setSelectedThreadHistory,
} from "@/stores/gateway/thread-open/thread-view-cache";
import { pinnedKey } from "@/stores/gateway/thread-utils/identity";

export function insertOptimisticSteerMessage(
  hostId: number,
  threadId: string,
  turnId: string,
  clientUserMessageId: string,
  content: unknown[],
) {
  updateThreadHistory(hostId, threadId, (history, currentThread) =>
    insertSteerItemIntoActiveTurn(history, currentThread, threadId, turnId, {
      type: "userMessage",
      id: clientUserMessageId,
      clientId: clientUserMessageId,
      turnId,
      createdAt: Date.now(),
      content,
    }),
  );
}

export function insertOptimisticNewTurnMessage(
  hostId: number,
  threadId: string,
  clientUserMessageId: string,
  content: unknown[],
) {
  updateThreadHistory(hostId, threadId, (history, currentThread) =>
    mergeItemIntoLatestTurn(history, currentThread, threadId, {
      type: "userMessage",
      id: clientUserMessageId,
      clientId: clientUserMessageId,
      createdAt: Date.now(),
      content,
    }),
  );
}

export function mergeStartedTurn(hostId: number, threadId: string, turn: ThreadHistoryTurn) {
  updateThreadHistory(hostId, threadId, (history, currentThread) =>
    mergeThreadTurns(history, currentThread, threadId, [turn], "append"),
  );
}

export function mergeTurnItems(hostId: number, threadId: string, turn: ThreadHistoryTurn) {
  updateThreadHistory(hostId, threadId, (history, currentThread) => {
    let nextHistory = history;
    for (const item of turn.items ?? []) {
      nextHistory = mergeItemIntoLatestTurn(nextHistory, currentThread, threadId, {
        ...item,
        turnId: turn.id,
      });
    }
    return nextHistory;
  });
}

function updateThreadHistory(
  hostId: number,
  threadId: string,
  update: (
    history: ThreadHistoryState | null,
    currentThread: ThreadHistorySeed | null,
  ) => ThreadHistoryState | null,
) {
  const navigation = useGatewayNavigationStore();
  const views = useGatewayThreadViewStore();
  if (navigation.selectedHostId === hostId && navigation.selectedThreadId === threadId) {
    setSelectedThreadHistory(update(views.history, views.currentThread));
    cacheSelectedThreadView();
    return;
  }
  const view = views.threadViews[pinnedKey(hostId, threadId)];
  if (view !== undefined) {
    patchThreadView(hostId, threadId, {
      history: update(view.history, view.currentThread),
    });
  }
}

export function upsertHistoryItem(hostId: number, threadId: string, item: ThreadHistoryItem) {
  const navigation = useGatewayNavigationStore();
  const views = useGatewayThreadViewStore();
  const update = (history: ThreadHistoryState | null, currentThread: ThreadHistorySeed | null) =>
    mergeItemIntoLatestTurn(history, currentThread, threadId, item);
  if (navigation.selectedHostId === hostId && navigation.selectedThreadId === threadId) {
    setSelectedThreadHistory(update(views.history, views.currentThread));
    cacheSelectedThreadView();
    return;
  }
  const key = pinnedKey(hostId, threadId);
  const view = views.threadViews[key];
  if (view) {
    // Background subscriptions can mutate a thread while another route is selected. Use the same
    // cache boundary as batched realtime events so history and timelineTurns remain atomic; direct
    // assignment here previously left the projection stale until a full page refresh.
    patchThreadView(hostId, threadId, {
      history: update(view.history, view.currentThread),
    });
  }
}

export function historyForThread(hostId: number, threadId: string) {
  const navigation = useGatewayNavigationStore();
  const views = useGatewayThreadViewStore();
  if (navigation.selectedHostId === hostId && navigation.selectedThreadId === threadId) {
    return views.history;
  }
  return views.threadViews[pinnedKey(hostId, threadId)]?.history ?? null;
}
