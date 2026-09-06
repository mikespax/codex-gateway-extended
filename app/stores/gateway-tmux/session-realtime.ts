import type { TmuxSessionsSnapshot } from "~~/shared/types";
import { useGatewayRealtimeStore } from "@/stores/gateway-realtime";

export function subscribeTmuxSessionStream(hostId: number) {
  return requestSnapshot("tmux.sessions.subscribe", hostId);
}

export function refreshTmuxSessionStream(hostId: number) {
  return requestSnapshot("tmux.sessions.refresh", hostId);
}

export function unsubscribeTmuxSessionStream(hostId: number) {
  useGatewayRealtimeStore().send({ type: "tmux.sessions.unsubscribe", hostId });
}

function requestSnapshot(
  type: "tmux.sessions.subscribe" | "tmux.sessions.refresh",
  hostId: number,
) {
  return useGatewayRealtimeStore().request(
    (requestId) => ({ type, requestId, hostId }),
    (message): TmuxSessionsSnapshot => {
      if (message.type !== "tmux.sessions.snapshot") {
        throw new Error(`Unexpected ${type} response: ${message.type}`);
      }
      return message;
    },
  );
}
