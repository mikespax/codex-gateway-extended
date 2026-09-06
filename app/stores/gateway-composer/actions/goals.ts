import type { ThreadGoal, ThreadGoalStatus } from "~~/shared/types";
import {
  expectThreadGoalSnapshot,
  expectThreadGoalUpdated,
} from "@/stores/gateway-realtime/response-parsers";
import { useGatewayComposerStore } from "@/stores/gateway-composer";
import { useGatewayNavigationStore } from "@/stores/gateway-navigation";
import { useGatewayRealtimeStore } from "@/stores/gateway-realtime";
import { gatewayDomainEvents } from "@/stores/gateway/domain-events";
import { threadGoalTimelineItem } from "@/stores/gateway/thread-goals/goal-timeline";
import { pinnedKey, selectedThreadScope } from "@/stores/gateway/thread-utils/identity";
import { captureSessionEpoch } from "@/utils/session-epoch";

export function createThreadGoalActions() {
  function upsertThreadGoal(
    hostId: number,
    threadId: string,
    goal: ThreadGoal,
    options: { showInTimeline?: boolean; turnId?: string | null } = {},
  ) {
    const composer = useGatewayComposerStore();
    const key = pinnedKey(hostId, threadId);
    if (options.showInTimeline === true) {
      const item = threadGoalTimelineItem(goal, options.turnId);
      if (item) gatewayDomainEvents.emit("history-item-upsert", { hostId, threadId, item });
    }
    composer.threadGoalsByKey = { ...composer.threadGoalsByKey, [key]: goal };
    composer.threadGoalObservedAtByKey = {
      ...composer.threadGoalObservedAtByKey,
      [key]: Date.now(),
    };
  }

  function clearThreadGoalState(hostId: number, threadId: string) {
    const composer = useGatewayComposerStore();
    const key = pinnedKey(hostId, threadId);
    const { [key]: _goal, ...goals } = composer.threadGoalsByKey;
    composer.threadGoalsByKey = goals;
    composer.threadGoalObservedAtByKey = {
      ...composer.threadGoalObservedAtByKey,
      [key]: Date.now(),
    };
  }

  return {
    upsertThreadGoal,
    clearThreadGoalState,
    async setSelectedThreadGoal(objective: string) {
      const sessionIsCurrent = captureSessionEpoch();
      const navigation = useGatewayNavigationStore();
      const scope = selectedThreadScope(navigation.selectedHostId, navigation.selectedThreadId);
      if (scope === null) return;
      const { hostId, threadId } = scope;
      const message = await useGatewayRealtimeStore().request(
        (requestId) => ({
          type: "thread.goal.set",
          requestId,
          hostId,
          threadId,
          objective,
          status: "active",
        }),
        expectThreadGoalUpdated,
      );
      if (!sessionIsCurrent()) return;
      upsertThreadGoal(hostId, threadId, message.goal, { showInTimeline: true });
    },
    async setSelectedThreadGoalStatus(status: ThreadGoalStatus) {
      const sessionIsCurrent = captureSessionEpoch();
      const navigation = useGatewayNavigationStore();
      const scope = selectedThreadScope(navigation.selectedHostId, navigation.selectedThreadId);
      if (scope === null) return;
      const { hostId, threadId } = scope;
      const message = await useGatewayRealtimeStore().request(
        (requestId) => ({
          type: "thread.goal.set",
          requestId,
          hostId,
          threadId,
          status,
        }),
        expectThreadGoalUpdated,
      );
      if (!sessionIsCurrent()) return;
      upsertThreadGoal(hostId, threadId, message.goal);
    },
    async clearSelectedThreadGoal() {
      const sessionIsCurrent = captureSessionEpoch();
      const navigation = useGatewayNavigationStore();
      const scope = selectedThreadScope(navigation.selectedHostId, navigation.selectedThreadId);
      if (scope === null) return;
      const { hostId, threadId } = scope;
      await useGatewayRealtimeStore().request((requestId) => ({
        type: "thread.goal.clear",
        requestId,
        hostId,
        threadId,
      }));
      if (!sessionIsCurrent()) return;
      clearThreadGoalState(hostId, threadId);
    },
    async refreshSelectedThreadGoal() {
      const sessionIsCurrent = captureSessionEpoch();
      const navigation = useGatewayNavigationStore();
      const scope = selectedThreadScope(navigation.selectedHostId, navigation.selectedThreadId);
      if (scope === null) return;
      const { hostId, threadId } = scope;
      const message = await useGatewayRealtimeStore().request(
        (requestId) => ({
          type: "thread.goal.get",
          requestId,
          hostId,
          threadId,
        }),
        expectThreadGoalSnapshot,
      );
      if (!sessionIsCurrent()) return;
      if (message.goal !== null) upsertThreadGoal(hostId, threadId, message.goal);
      else clearThreadGoalState(hostId, threadId);
    },
  };
}
