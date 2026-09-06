import type { RealtimeClientMessage } from "~~/shared/types";

type RealtimeRequestMessage = Extract<RealtimeClientMessage, { requestId: string }>;

export class RealtimeRequestError extends Error {
  constructor(
    message: string,
    readonly request: RealtimeRequestMessage | undefined,
    readonly reason: "timeout" | "unavailable" | "disconnected" | "server",
    readonly details: Record<string, unknown> = {},
  ) {
    super(formatRealtimeRequestError(message, request, details));
    this.name = "RealtimeRequestError";
  }
}

export function realtimeRequestErrorFromServer(
  message: string,
  request: RealtimeRequestMessage | undefined,
  details: Record<string, unknown> = {},
) {
  return new RealtimeRequestError(message, request, "server", details);
}

function formatRealtimeRequestError(
  message: string,
  request: RealtimeRequestMessage | undefined,
  details: Record<string, unknown>,
) {
  const lines = [message];
  const context = [
    request === undefined ? null : `type=${request.type}`,
    typeof details.hostName === "string" && details.hostName.trim() !== ""
      ? `host=${details.hostName.trim()}`
      : null,
    request !== undefined && "hostId" in request ? `hostId=${request.hostId}` : null,
    request !== undefined && "threadId" in request ? `threadId=${request.threadId}` : null,
    request === undefined ? null : `requestId=${request.requestId}`,
    typeof details.timeoutMs === "number" ? `timeoutMs=${details.timeoutMs}` : null,
    typeof details.serverRequestId === "string" || typeof details.serverRequestId === "number"
      ? `serverRequestId=${details.serverRequestId}`
      : null,
  ].filter((entry): entry is string => entry !== null);
  if (context.length > 0) {
    lines.push(context.join(" · "));
  }
  return lines.join("\n");
}
