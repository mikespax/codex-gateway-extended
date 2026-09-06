import { recordFromUnknown } from "./utils/records";

export const STALE_THREAD_CURSOR_ERROR_CODE = "staleThreadCursor";
const STALE_THREAD_CURSOR_ERROR_PREFIX = "invalid cursor:";

export function isStaleThreadCursorErrorLike(error: unknown) {
  const candidate = recordFromUnknown(error);
  // Error.message is intentionally non-enumerable, so Zod's object parser cannot carry it into
  // the plain record. Keep Zod for the transport-specific enumerable fields and use the standard
  // Error contract for the built-in message instead of weakening the RPC discriminator.
  const candidateMessage = candidate?.message;
  const message =
    error instanceof Error
      ? error.message
      : typeof candidateMessage === "string"
        ? candidateMessage
        : null;
  return (
    candidate?.rpcMethod === "thread/turns/list" &&
    candidate?.rpcCode === -32600 &&
    // Codex 0.147 paginated cursors embed their dynamic `{ turnId, includeAnchor }` anchor in the
    // message. Classify the protocol error by method, JSON-RPC code and stable prefix; full-string
    // equality is only valid for the legacy rollout message and misroutes paginated recovery.
    message?.startsWith(STALE_THREAD_CURSOR_ERROR_PREFIX) === true
  );
}
