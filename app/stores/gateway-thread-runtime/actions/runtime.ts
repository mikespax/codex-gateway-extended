import type {
  ThreadRuntimeStatus,
  ThreadTokenUsageState,
  ThreadTurnUsageSummary,
} from "~~/shared/types";
import { useGatewayThreadRuntimeStore } from "@/stores/gateway-thread-runtime";
import type { ThreadStatusUpdateOptions } from "@/stores/gateway/types";
import {
  applyThreadRuntimeStatus,
  projectThreadRuntime,
} from "@/stores/gateway/thread-runtime/projector";
import { pinnedKey } from "@/stores/gateway/thread-utils/identity";

export function createThreadRuntimeActions() {
  return {
    setThreadRunning(hostId: number, threadId: string, running: boolean) {
      applyThreadRuntimeStatus(hostId, threadId, {
        status: running ? "running" : "completed",
      });
    },
    setThreadStatus(
      hostId: number,
      threadId: string,
      status: ThreadRuntimeStatus,
      options: ThreadStatusUpdateOptions = {},
    ) {
      applyThreadRuntimeStatus(hostId, threadId, { status, turnId: options.turnId });
    },
    setThreadTokenUsage(hostId: number, threadId: string, tokenUsage: ThreadTokenUsageState) {
      const runtime = useGatewayThreadRuntimeStore();
      runtime.threadTokenUsageByKey = {
        ...runtime.threadTokenUsageByKey,
        [pinnedKey(hostId, threadId)]: tokenUsage,
      };
    },
    setThreadTurnUsage(hostId: number, usage: ThreadTurnUsageSummary) {
      const runtime = useGatewayThreadRuntimeStore();
      const key = turnUsageKey(hostId, usage.threadId, usage.turnId);
      runtime.threadTurnUsageByKey = {
        ...runtime.threadTurnUsageByKey,
        [key]: usage,
      };
    },
    setThreadTurnUsages(hostId: number, threadId: string, usages: ThreadTurnUsageSummary[]) {
      const runtime = useGatewayThreadRuntimeStore();
      const next = { ...runtime.threadTurnUsageByKey };
      for (const usage of usages) {
        if (usage.threadId === threadId) next[turnUsageKey(hostId, threadId, usage.turnId)] = usage;
      }
      runtime.threadTurnUsageByKey = next;
    },
    turnUsageFor(hostId: number, threadId: string, turnId: string) {
      return (
        useGatewayThreadRuntimeStore().threadTurnUsageByKey[
          turnUsageKey(hostId, threadId, turnId)
        ] ?? null
      );
    },
    threadRuntimeProjection(hostId: number, threadId: string) {
      return projectThreadRuntime(hostId, threadId);
    },
  };
}

function turnUsageKey(hostId: number, threadId: string, turnId: string) {
  return `${pinnedKey(hostId, threadId)}:${turnId}`;
}
