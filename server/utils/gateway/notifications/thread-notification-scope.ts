import type { GatewayEvent } from "~~/shared/types";
import { isAppServerSubAgentThread, parseAppServerThread } from "~~/shared/runtime/app-server";
import { threadMetadataStore } from "../state/thread-metadata";
import { subAgentThreadStore } from "../state/sub-agent-threads";
import type { ThreadMetadataResolver } from "../runtime/thread-runtime-events";
import { recordFromUnknown } from "~~/shared/utils/records";

export async function shouldNotifyMainThread(
  event: GatewayEvent,
  resolveThread: ThreadMetadataResolver | undefined,
) {
  if (resolveThread === undefined) {
    return false;
  }

  try {
    const result = await resolveThread();
    const record = recordFromUnknown(result);
    const thread = parseAppServerThread(record?.thread ?? result);
    // Notifications for a thread opened outside Gateway still need its real title
    // and cwd. This is a volatile index only; app-server remains authoritative.
    threadMetadataStore.record(event.hostId, null, thread);
    return !isAppServerSubAgentThread(thread);
  } catch (error) {
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
