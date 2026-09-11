import { defineStore } from "pinia";
import { reactive, toRefs } from "vue";
import type { ComposerTurnOptions, QueuedTurn } from "~~/shared/types";
import { pinnedKey } from "../gateway/thread-utils/identity";
import { createGatewayThreadTurnActions } from "./actions";

export interface SubmittedTurnRequestState {
  kind: "start" | "steer";
  hostId: number;
  projectId: number | null;
  threadId: string;
  cwd: string | null;
  text: string;
  options: ComposerTurnOptions;
  retryCount: number;
  pendingRetryTurnId: string | null;
  retryTimer: number | null;
}

export type SubmittedTurnRequestInput = Omit<
  SubmittedTurnRequestState,
  "retryCount" | "pendingRetryTurnId" | "retryTimer"
>;

export type QueueTurnInput = Omit<QueuedTurn, "id" | "createdAt"> & {
  id?: string;
  createdAt?: number;
};

export const useGatewayThreadTurnsStore = defineStore("gateway-thread-turns", () => {
  const state = reactive<{ submittedTurnRequestsByKey: Record<string, SubmittedTurnRequestState> }>(
    {
      submittedTurnRequestsByKey: {},
    },
  );
  const queuedTurnsByKey = reactive<Record<string, QueuedTurn[]>>({});
  const flushingQueueKeys = new Set<string>();

  function requestKey(hostId: number, threadId: string) {
    return pinnedKey(hostId, threadId);
  }

  function requestForThread(hostId: number, threadId: string) {
    return state.submittedTurnRequestsByKey[requestKey(hostId, threadId)];
  }

  function rememberRequest(input: SubmittedTurnRequestInput) {
    const key = requestKey(input.hostId, input.threadId);
    const existing = state.submittedTurnRequestsByKey[key];
    if (existing?.retryTimer !== null && existing?.retryTimer !== undefined) {
      clearTimeout(existing.retryTimer);
    }
    state.submittedTurnRequestsByKey = {
      ...state.submittedTurnRequestsByKey,
      [key]: {
        ...input,
        retryCount: 0,
        pendingRetryTurnId: null,
        retryTimer: null,
      },
    };
  }

  function clearRequest(hostId: number, threadId: string) {
    const key = requestKey(hostId, threadId);
    const existing = state.submittedTurnRequestsByKey[key];
    if (existing?.retryTimer !== null && existing?.retryTimer !== undefined) {
      clearTimeout(existing.retryTimer);
    }
    const { [key]: _removed, ...remaining } = state.submittedTurnRequestsByKey;
    state.submittedTurnRequestsByKey = remaining;
  }

  function patchRequest(
    hostId: number,
    threadId: string,
    patch: Partial<SubmittedTurnRequestState>,
  ) {
    const key = requestKey(hostId, threadId);
    const current = state.submittedTurnRequestsByKey[key];
    if (current === undefined) {
      return;
    }
    state.submittedTurnRequestsByKey = {
      ...state.submittedTurnRequestsByKey,
      [key]: {
        ...current,
        ...patch,
      },
    };
  }

  function setRequest(key: string, request: SubmittedTurnRequestState) {
    state.submittedTurnRequestsByKey = {
      ...state.submittedTurnRequestsByKey,
      [key]: request,
    };
  }

  function requestByKey(key: string) {
    return state.submittedTurnRequestsByKey[key];
  }

  function queuedForThread(hostId: number, threadId: string) {
    return queuedTurnsByKey[requestKey(hostId, threadId)] ?? [];
  }

  function queueTurn(input: QueueTurnInput) {
    const key = requestKey(input.hostId, input.threadId);
    const queue = queuedTurnsByKey[key] ?? [];
    if (queue.length >= 20) {
      throw new Error("The follow-up queue is full (maximum 20 messages)");
    }
    const item: QueuedTurn = {
      ...input,
      id: input.id ?? `queued-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: input.createdAt ?? Date.now(),
    };
    queuedTurnsByKey[key] = [...queue, item];
    return item;
  }

  function updateQueuedTurn(
    hostId: number,
    threadId: string,
    queuedId: string,
    patch: Partial<Pick<QueuedTurn, "text" | "options">>,
  ) {
    const key = requestKey(hostId, threadId);
    const queue = queuedTurnsByKey[key] ?? [];
    const index = queue.findIndex((item) => item.id === queuedId);
    if (index < 0) return false;
    queuedTurnsByKey[key] = queue.map((item, itemIndex) =>
      itemIndex === index ? { ...item, ...patch } : item,
    );
    return true;
  }

  function removeQueuedTurn(hostId: number, threadId: string, queuedId: string) {
    const key = requestKey(hostId, threadId);
    const queue = queuedTurnsByKey[key] ?? [];
    const next = queue.filter((item) => item.id !== queuedId);
    if (next.length === queue.length) return false;
    if (next.length === 0) delete queuedTurnsByKey[key];
    else queuedTurnsByKey[key] = next;
    return true;
  }

  function takeQueuedTurn(hostId: number, threadId: string, queuedId?: string) {
    const key = requestKey(hostId, threadId);
    const queue = queuedTurnsByKey[key] ?? [];
    if (queue.length === 0) return null;
    const index = queuedId === undefined ? 0 : queue.findIndex((item) => item.id === queuedId);
    if (index < 0) return null;
    const [item] = queue.splice(index, 1);
    if (queue.length === 0) delete queuedTurnsByKey[key];
    else queuedTurnsByKey[key] = [...queue];
    return item ?? null;
  }

  function prependQueuedTurn(item: QueuedTurn) {
    const key = requestKey(item.hostId, item.threadId);
    queuedTurnsByKey[key] = [item, ...(queuedTurnsByKey[key] ?? [])];
  }

  function beginQueueFlush(hostId: number, threadId: string) {
    const key = requestKey(hostId, threadId);
    if (flushingQueueKeys.has(key)) return false;
    flushingQueueKeys.add(key);
    return true;
  }

  function endQueueFlush(hostId: number, threadId: string) {
    flushingQueueKeys.delete(requestKey(hostId, threadId));
  }

  function resetState() {
    for (const request of Object.values(state.submittedTurnRequestsByKey)) {
      if (request.retryTimer !== null) {
        clearTimeout(request.retryTimer);
      }
    }
    state.submittedTurnRequestsByKey = {};
    for (const key of Object.keys(queuedTurnsByKey)) delete queuedTurnsByKey[key];
    flushingQueueKeys.clear();
  }

  const actions = createGatewayThreadTurnActions();

  return {
    ...toRefs(state),
    requestKey,
    requestForThread,
    rememberRequest,
    clearRequest,
    patchRequest,
    setRequest,
    requestByKey,
    queuedTurnsByKey,
    queuedForThread,
    queueTurn,
    updateQueuedTurn,
    removeQueuedTurn,
    takeQueuedTurn,
    prependQueuedTurn,
    beginQueueFlush,
    endQueueFlush,
    resetState,
    ...actions,
  };
});
