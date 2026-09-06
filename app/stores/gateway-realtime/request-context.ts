import type { RealtimeClientMessage } from "~~/shared/types";

type RealtimeRequestMessage = Extract<RealtimeClientMessage, { requestId: string }>;
type RequestContextResolver = (request: RealtimeRequestMessage) => Record<string, unknown>;

let resolveRequestContext: RequestContextResolver = () => ({});

export function setRealtimeRequestContextResolver(resolver: RequestContextResolver) {
  resolveRequestContext = resolver;
}

export function realtimeRequestContext(request: RealtimeRequestMessage) {
  return resolveRequestContext(request);
}
