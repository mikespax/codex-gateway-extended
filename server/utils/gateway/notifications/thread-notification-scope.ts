import type { GatewayEvent } from "~~/shared/types";
import { isAppServerSubAgentThread, parseAppServerThread } from "~~/shared/runtime/app-server";
import { threadMetadataStore } from "../state/thread-metadata";
import { subAgentThreadStore } from "../state/sub-agent-threads";
import type { ThreadMetadataResolver } from "../runtime/thread-runtime-events";
import { recordFromUnknown } from "~~/shared/utils/records";
import { currentGatewayUserId } from "../state/memory";

const SCOPE_INSPECTION_FAILURE_BACKOFF_MS = 30_000;
const pendingScopeInspections = new Map<string, Promise<boolean>>();
const scopeInspectionRetryAfter = new Map<string, number>();

export async function shouldNotifyMainThread(
  event: GatewayEvent,
  resolveThread: ThreadMetadataResolver | undefined,
) {
  if (resolveThread === undefined) {
    return false;
  }

  // Scope is immutable for a thread, while titles and previews are refreshed through the normal
  // thread-list/open paths. Avoid making a slow app-server read part of every notification when
  // this process already has authoritative metadata for the thread.
  const cached = threadMetadataStore.get(event.hostId, event.threadId);
  if (cached !== null) {
    return !subAgentThreadStore.isSubAgentThread(event.hostId, event.threadId);
  }

  const userId = currentGatewayUserId();
  if (userId === null) return false;
  const key = `${userId}:${event.hostId}:${event.threadId}`;
  const pending = pendingScopeInspections.get(key);
  if (pending !== undefined) return pending;
  const retryAfter = scopeInspectionRetryAfter.get(key) ?? 0;
  if (retryAfter > Date.now()) return false;

  const inspection = inspectThreadScope(event, resolveThread, key);
  pendingScopeInspections.set(key, inspection);
  return inspection.finally(() => {
    if (pendingScopeInspections.get(key) === inspection) {
      pendingScopeInspections.delete(key);
    }
  });
}

async function inspectThreadScope(
  event: GatewayEvent,
  resolveThread: ThreadMetadataResolver,
  key: string,
) {
  try {
    const result = await resolveThread();
    const record = recordFromUnknown(result);
    const thread = parseAppServerThread(record?.thread ?? result);
    // Notifications for a thread opened outside Gateway still need its real title
    // and cwd. This is a volatile index only; app-server remains authoritative.
    threadMetadataStore.record(event.hostId, null, thread);
    scopeInspectionRetryAfter.delete(key);
    return !isAppServerSubAgentThread(thread);
  } catch (error) {
    scopeInspectionRetryAfter.set(key, Date.now() + SCOPE_INSPECTION_FAILURE_BACKOFF_MS);
    console.error("[gateway] failed to inspect thread scope before notification", {
      hostId: event.hostId,
      threadId: event.threadId,
      error: error instanceof Error ? error.message : String(error),
    });
    // A transient thread/read failure must not discard a question or completion event when this
    // process has already parsed authoritative metadata for the same thread. Unknown threads still
    // fail closed, and the dedicated sub-agent index preserves source.subAgent classifications
    // that cannot be represented by parentThreadId alone.
    const cached = threadMetadataStore.get(event.hostId, event.threadId);
    if (cached !== null) {
      return !subAgentThreadStore.isSubAgentThread(event.hostId, event.threadId);
    }
  }

  // Unknown scope is treated as notifiable=false to avoid child-agent false positives.
  return false;
}
