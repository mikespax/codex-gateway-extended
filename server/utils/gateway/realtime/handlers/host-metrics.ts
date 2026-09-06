import type { RealtimeClientMessage } from "~~/shared/types";
import { hostMetricsManager } from "../../infra/host-services";
import { hostStore } from "../../state/hosts";
import {
  authenticatedUserId,
  sendRealtimePeerMessage,
  stateFor,
  type RealtimePeer,
} from "../peer-state";
import { removeSubscription, replaceSubscription } from "../subscription-map";

export function subscribeHostMetrics(
  peer: RealtimePeer,
  request: Extract<RealtimeClientMessage, { type: "host.metrics.subscribe" }>,
) {
  const userId = authenticatedUserId(peer);
  if (hostStore.get(request.hostId) === null) throw new Error(`Host ${request.hostId} not found`);
  const subscriptions = stateFor(peer).hostMetricsUnsubscribers;
  replaceSubscription(subscriptions, request.hostId, () =>
    hostMetricsManager.events.subscribe(userId, request.hostId, (event) => {
      if (event.type === "sample") {
        sendRealtimePeerMessage(peer, {
          type: "host.metrics.sample",
          hostId: event.hostId,
          sample: event.sample,
          gpuProcesses: event.gpuProcesses,
        });
      } else {
        sendRealtimePeerMessage(peer, {
          type: "host.metrics.status",
          hostId: event.snapshot.hostId,
          status: event.snapshot.status,
          message: event.snapshot.message,
        });
      }
    }),
  );
  sendRealtimePeerMessage(peer, {
    type: "host.metrics.snapshot",
    requestId: request.requestId,
    ...hostMetricsManager.snapshot(userId, request.hostId),
  });
}

export function unsubscribeHostMetrics(
  peer: RealtimePeer,
  request: Extract<RealtimeClientMessage, { type: "host.metrics.unsubscribe" }>,
) {
  const subscriptions = stateFor(peer).hostMetricsUnsubscribers;
  removeSubscription(subscriptions, request.hostId);
}
