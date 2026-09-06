import type { ThreadHistorySeed, ThreadHistoryState } from "~~/shared/thread-history/types";
import {
  appendAgentDelta,
  appendCommandOutputDelta,
  appendPlanDelta,
  appendReasoningSummaryDelta,
  appendReasoningTextDelta,
} from "~~/shared/thread-history/deltas";
import { updateTurnDiff } from "~~/shared/thread-history/diff";
import { mergeItemIntoLatestTurn } from "~~/shared/thread-history/items";
import { resolveServerRequestInHistory } from "~~/shared/thread-history/requests";
import { mergeThreadTurns, syncCompletedTurn } from "~~/shared/thread-history/turns";
import { useGatewayNavigationStore } from "@/stores/gateway-navigation";
import { useGatewayThreadViewStore } from "@/stores/gateway-thread-view";
import { applyAppServerEvent } from "../event-handlers";
import { gatewayDomainEvents } from "../domain-events";
import { patchThreadView, setSelectedThreadHistory } from "../thread-open/thread-view-cache";
import { pinnedKey } from "../thread-utils/identity";

type HistoryUpdate = (
  history: ThreadHistoryState | null,
  currentThread: ThreadHistorySeed | null,
) => ThreadHistoryState;

interface PendingHistoryProjection {
  hostId: number;
  threadId: string;
  updates: HistoryUpdate[];
}

let pendingHistoryProjections: Map<string, PendingHistoryProjection> | null = null;

export function registerHistoryProjectionSubscribers() {
  gatewayDomainEvents.on("realtime-thread-event", ({ event }) => {
    const views = useGatewayThreadViewStore();
    if (event.id <= views.lastAppliedThreadEventId(event.hostId, event.threadId)) return;
    views.queueThreadEvent(event);
  });
  gatewayDomainEvents.on("history-events-project", ({ events }) => {
    batchGatewayHistoryProjections(() => {
      for (const event of events) applyAppServerEvent(event);
    });
  });
  gatewayDomainEvents.on("history-item-upsert", (event) => {
    updateThreadHistory(event.hostId, event.threadId, (history, currentThread) =>
      mergeItemIntoLatestTurn(history, currentThread, event.threadId, event.item),
    );
  });
  gatewayDomainEvents.on("history-agent-delta", (event) => {
    updateThreadHistory(event.hostId, event.threadId, (history, currentThread) =>
      appendAgentDelta(history, currentThread, event.threadId, event.params),
    );
  });
  gatewayDomainEvents.on("history-plan-delta", (event) => {
    updateThreadHistory(event.hostId, event.threadId, (history, currentThread) =>
      appendPlanDelta(history, currentThread, event.threadId, event.params),
    );
  });
  gatewayDomainEvents.on("history-reasoning-summary-delta", (event) => {
    updateThreadHistory(event.hostId, event.threadId, (history, currentThread) =>
      appendReasoningSummaryDelta(history, currentThread, event.threadId, event.params),
    );
  });
  gatewayDomainEvents.on("history-reasoning-text-delta", (event) => {
    updateThreadHistory(event.hostId, event.threadId, (history, currentThread) =>
      appendReasoningTextDelta(history, currentThread, event.threadId, event.params),
    );
  });
  gatewayDomainEvents.on("history-command-output-delta", (event) => {
    updateThreadHistory(event.hostId, event.threadId, (history, currentThread) =>
      appendCommandOutputDelta(history, currentThread, event.threadId, event.params),
    );
  });
  gatewayDomainEvents.on("history-server-request-resolved", (event) => {
    updateThreadHistory(event.hostId, event.threadId, (history, currentThread) =>
      resolveServerRequestInHistory(history, currentThread, event.threadId, event.requestId),
    );
  });
  gatewayDomainEvents.on("history-turn-diff-updated", (event) => {
    updateThreadHistory(event.hostId, event.threadId, (history, currentThread) =>
      updateTurnDiff(history, currentThread, event.threadId, event.params),
    );
  });
  gatewayDomainEvents.on("history-turn-appended", (event) => {
    updateThreadHistory(event.hostId, event.threadId, (history, currentThread) =>
      mergeThreadTurns(history, currentThread, event.threadId, [event.turn], "append"),
    );
  });
  gatewayDomainEvents.on("history-turn-synced", (event) => {
    updateThreadHistory(event.hostId, event.threadId, (history, currentThread) =>
      syncCompletedTurn(history, currentThread, event.threadId, event.turn),
    );
  });
}

function batchGatewayHistoryProjections(applyEvents: () => void) {
  if (pendingHistoryProjections) {
    applyEvents();
    return;
  }
  pendingHistoryProjections = new Map();
  try {
    applyEvents();
    for (const projection of pendingHistoryProjections.values()) {
      applyThreadHistoryUpdates(projection.hostId, projection.threadId, projection.updates);
    }
  } finally {
    pendingHistoryProjections = null;
  }
}

function updateThreadHistory(hostId: number, threadId: string, update: HistoryUpdate) {
  if (pendingHistoryProjections) {
    const key = pinnedKey(hostId, threadId);
    const projection = pendingHistoryProjections.get(key) ?? { hostId, threadId, updates: [] };
    projection.updates.push(update);
    pendingHistoryProjections.set(key, projection);
    return;
  }
  applyThreadHistoryUpdates(hostId, threadId, [update]);
}

function applyThreadHistoryUpdates(hostId: number, threadId: string, updates: HistoryUpdate[]) {
  const navigation = useGatewayNavigationStore();
  const views = useGatewayThreadViewStore();
  if (navigation.selectedHostId === hostId && navigation.selectedThreadId === threadId) {
    setSelectedThreadHistory(
      updates.reduce((history, update) => update(history, views.currentThread), views.history),
    );
    views.cacheSelectedThreadView();
    return;
  }
  const view = views.threadViews[pinnedKey(hostId, threadId)];
  if (view) {
    patchThreadView(hostId, threadId, {
      history: updates.reduce(
        (history, update) => update(history, view.currentThread),
        view.history,
      ),
    });
  }
}
