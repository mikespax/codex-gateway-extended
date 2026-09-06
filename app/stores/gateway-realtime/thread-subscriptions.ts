import type { GatewayEvent, RealtimeClientMessage } from "~~/shared/types";
import { pinnedKey } from "../gateway/thread-utils/identity";
import { threadViewSubscriptionLeases } from "../gateway/thread-open/thread-view-subscription-leases";

export interface RealtimeThreadSubscription {
  hostId: number;
  threadId: string;
  afterId: number;
  afterEpoch?: string;
}

export interface RealtimeThreadSubscriptionState {
  hostLifecycleSubscribed: boolean;
  threadSubscriptions: Record<string, RealtimeThreadSubscription>;
}

interface RealtimeThreadSubscriptionOptions {
  connect: () => void;
  send: (message: RealtimeClientMessage) => boolean;
}

export function createRealtimeThreadSubscriptions(options: RealtimeThreadSubscriptionOptions) {
  const state = reactive<RealtimeThreadSubscriptionState>({
    hostLifecycleSubscribed: false,
    threadSubscriptions: {},
  });
  function connectHostLifecycleEvents() {
    if (!import.meta.client) return;
    state.hostLifecycleSubscribed = true;
    options.connect();
    options.send({ type: "host.lifecycle.subscribe" });
  }

  function connectThreadEvents(
    hostId: number,
    threadId: string,
    afterId: number,
    afterEpoch: string | undefined,
  ) {
    const key = pinnedKey(hostId, threadId);
    const subscription = { hostId, threadId, afterId, afterEpoch };
    rememberSubscription(key, subscription);
    options.connect();
    sendThreadSubscribe(subscription);
  }

  function rememberThreadSubscription(
    hostId: number,
    threadId: string,
    afterId: number,
    afterEpoch: string | undefined,
  ) {
    rememberSubscription(pinnedKey(hostId, threadId), { hostId, threadId, afterId, afterEpoch });
  }

  function rememberSubscription(key: string, subscription: RealtimeThreadSubscription) {
    state.threadSubscriptions = {
      ...state.threadSubscriptions,
      [key]: subscription,
    };
    threadViewSubscriptionLeases.retain(subscription.hostId, subscription.threadId, () => {
      dropThreadSubscription(subscription.hostId, subscription.threadId, true);
    });
  }

  function closeThreadEvents(hostId: number, threadId: string) {
    if (threadViewSubscriptionLeases.release(hostId, threadId)) return;
    dropThreadSubscription(hostId, threadId, true);
  }

  function cancelThreadEvents(hostId: number, threadId: string) {
    // A thread.activate response can arrive after its preview panel was closed. There may be no
    // local lease to release yet, but app-server has already subscribed this WebSocket peer, so
    // cancellation must always send the protocol-level unsubscribe.
    dropThreadSubscription(hostId, threadId, false);
    options.send({ type: "thread.unsubscribe", hostId, threadId });
  }

  function dropThreadSubscription(hostId: number, threadId: string, notifyServer: boolean) {
    const key = pinnedKey(hostId, threadId);
    const { [key]: closed, ...subscriptions } = state.threadSubscriptions;
    if (!closed) return;
    state.threadSubscriptions = subscriptions;
    if (notifyServer) options.send({ type: "thread.unsubscribe", hostId, threadId });
  }

  function closeHostThreadEvents(hostId: number) {
    for (const subscription of Object.values(state.threadSubscriptions)) {
      if (subscription.hostId === hostId) {
        closeThreadEvents(subscription.hostId, subscription.threadId);
      }
    }
  }

  function resubscribe() {
    if (state.hostLifecycleSubscribed) options.send({ type: "host.lifecycle.subscribe" });
    for (const subscription of Object.values(state.threadSubscriptions)) {
      sendThreadSubscribe(subscription);
    }
  }

  function advanceThreadSubscriptionCursor(event: GatewayEvent) {
    const key = pinnedKey(event.hostId, event.threadId);
    const subscription = state.threadSubscriptions[key];
    if (!subscription || event.id <= subscription.afterId) return;
    state.threadSubscriptions = {
      ...state.threadSubscriptions,
      [key]: { ...subscription, afterId: event.id },
    };
  }

  function reset() {
    threadViewSubscriptionLeases.clearWithoutRelease();
    state.hostLifecycleSubscribed = false;
    state.threadSubscriptions = {};
  }

  function sendThreadSubscribe(subscription: RealtimeThreadSubscription) {
    options.send({
      type: "thread.subscribe",
      hostId: subscription.hostId,
      threadId: subscription.threadId,
      afterId: subscription.afterId,
      ...(subscription.afterEpoch !== undefined && subscription.afterEpoch !== ""
        ? { afterEpoch: subscription.afterEpoch }
        : {}),
    });
  }

  return {
    state,
    connectHostLifecycleEvents,
    connectThreadEvents,
    rememberThreadSubscription,
    closeThreadEvents,
    cancelThreadEvents,
    closeHostThreadEvents,
    resubscribe,
    advanceThreadSubscriptionCursor,
    reset,
  };
}
