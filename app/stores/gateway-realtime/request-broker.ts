import type { RealtimeClientMessage, RealtimeServerMessage } from "~~/shared/types";
import { createUuid } from "@/lib/uuid";
import { RealtimeRequestError } from "./request-errors";

type RealtimeRequestMessage = Extract<RealtimeClientMessage, { requestId: string }>;
type RealtimeResponseMessage = Extract<RealtimeServerMessage, { requestId: string }>;

interface PendingRealtimeRequest {
  resolve: (value: RealtimeResponseMessage) => void;
  reject: (error: Error) => void;
  timer: number;
  request: RealtimeRequestMessage;
  errorMode: RealtimeRequestErrorMode;
}

export type RealtimeRequestErrorMode = "return" | "notify";

interface RealtimeRequestOptions {
  timeoutMs?: number;
  errorMode?: RealtimeRequestErrorMode;
}

export interface RealtimeRequestRejection {
  delivered: boolean;
  notify: boolean;
}

interface RealtimeRequestBrokerOptions {
  waitForReady: (timeoutMs: number) => Promise<void>;
  send: (message: RealtimeClientMessage) => boolean;
  unavailableMessage: () => string;
  timeoutMessage: () => string;
  requestContext: (request: RealtimeRequestMessage) => Record<string, unknown>;
}

const REALTIME_READY_TIMEOUT_MS = 15_000;
// SSH reconnect and a remote Codex upgrade can precede app-server RPC work.
// Keep the browser deadline beyond the backend's 30-minute operation cap.
const REALTIME_REQUEST_TIMEOUT_MS = 31 * 60_000;

export function createRealtimeRequestBroker(options: RealtimeRequestBrokerOptions) {
  const pendingRequests = new Map<string, PendingRealtimeRequest>();

  function request(
    buildMessage: (requestId: string) => RealtimeRequestMessage,
    options?: RealtimeRequestOptions,
  ): Promise<RealtimeResponseMessage>;
  function request<T>(
    buildMessage: (requestId: string) => RealtimeRequestMessage,
    parse: (message: RealtimeResponseMessage) => T,
    options?: RealtimeRequestOptions,
  ): Promise<T>;
  async function request<T>(
    buildMessage: (requestId: string) => RealtimeRequestMessage,
    parseOrOptions?: ((message: RealtimeResponseMessage) => T) | RealtimeRequestOptions,
    configuredOptions?: RealtimeRequestOptions,
  ): Promise<RealtimeResponseMessage | T> {
    await options.waitForReady(REALTIME_READY_TIMEOUT_MS);
    const requestId = `gateway-ws-${createUuid()}`;
    const requestMessage = buildMessage(requestId);
    const parse = typeof parseOrOptions === "function" ? parseOrOptions : undefined;
    const requestOptions =
      typeof parseOrOptions === "function" ? configuredOptions : parseOrOptions;
    const timeoutMs = requestOptions?.timeoutMs ?? REALTIME_REQUEST_TIMEOUT_MS;
    const errorMode = requestOptions?.errorMode ?? "return";

    const response = await new Promise<RealtimeResponseMessage>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        pendingRequests.delete(requestId);
        reject(
          new RealtimeRequestError(options.timeoutMessage(), requestMessage, "timeout", {
            requestId,
            timeoutMs,
            ...options.requestContext(requestMessage),
          }),
        );
      }, timeoutMs);

      pendingRequests.set(requestId, {
        resolve,
        reject,
        timer,
        request: requestMessage,
        errorMode,
      });
      if (!options.send(requestMessage)) {
        rejectRequest(
          requestId,
          new RealtimeRequestError(options.unavailableMessage(), requestMessage, "unavailable", {
            requestId,
            ...options.requestContext(requestMessage),
          }),
        );
      }
    });
    return parse === undefined ? response : parse(response);
  }

  function resolveRequest(message: RealtimeResponseMessage) {
    const pending = pendingRequests.get(message.requestId);
    if (!pending) return;
    window.clearTimeout(pending.timer);
    pendingRequests.delete(message.requestId);
    pending.resolve(message);
  }

  function rejectRequest(requestId: string, error: Error) {
    const pending = pendingRequests.get(requestId);
    if (!pending) return { delivered: false, notify: true };
    window.clearTimeout(pending.timer);
    pendingRequests.delete(requestId);
    pending.reject(error);
    return { delivered: true, notify: pending.errorMode === "notify" };
  }

  function rejectAllRequests(error: Error) {
    for (const [requestId, pending] of pendingRequests) {
      rejectRequest(
        requestId,
        new RealtimeRequestError(error.message, pending.request, "disconnected", {
          requestId,
          ...options.requestContext(pending.request),
        }),
      );
    }
  }

  return { request, resolveRequest, rejectRequest, rejectAllRequests };
}
