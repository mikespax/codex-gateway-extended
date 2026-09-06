import { useGatewayComposerStore } from "@/stores/gateway-composer";
import { threadGoalFromUnknown } from "~~/shared/runtime/app-server";
import type { GatewayEventHandlerRegistry } from "./types";

export const goalEventHandlers: GatewayEventHandlerRegistry = {
  "thread/goal/updated": (event, params, threadId) => {
    const goal = threadGoalFromUnknown(params.goal);
    if (goal) useGatewayComposerStore().upsertThreadGoal(event.hostId, threadId, goal);
  },
  "thread/goal/cleared": (event, _params, threadId) => {
    useGatewayComposerStore().clearThreadGoalState(event.hostId, threadId);
  },
};
