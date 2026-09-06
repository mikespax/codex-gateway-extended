import { useGatewayNavigationStore } from "@/stores/gateway-navigation";
import { useGatewayThreadViewStore } from "@/stores/gateway-thread-view";
import { subAgentTitleCandidate } from "@/components/thread/subagent/display-name";

interface OpenSubAgentInput {
  hostId: number | null;
  threadId: string | null;
  titleCandidate?: unknown;
  parentHostId?: number | null;
  parentThreadId?: string | null;
}

export function useOpenSubAgentPanel() {
  const navigation = useGatewayNavigationStore();
  const threadView = useGatewayThreadViewStore();

  function openSubAgentPanel(input: OpenSubAgentInput) {
    if (input.hostId === null || input.threadId === null || input.threadId === "") {
      return Promise.resolve();
    }
    return threadView.openSubAgentPanel({
      hostId: input.hostId,
      threadId: input.threadId,
      title: subAgentTitleCandidate(input.titleCandidate, input.threadId),
      parentHostId: input.parentHostId ?? navigation.selectedHostId,
      parentThreadId: input.parentThreadId ?? navigation.selectedThreadId,
    });
  }

  return { openSubAgentPanel };
}
