import type { GatewayEvent } from "../../../../../../shared/types";
import { defineGatewayEventHandler } from "../../../../../../server/utils/gateway/http/errors";
import { shouldNotifyMainThread } from "../../../../../../server/utils/gateway/notifications/thread-notification-scope";

export default defineGatewayEventHandler(async () => {
  const concurrentThreadId = `e2e-notification-scope-${Date.now()}`;
  let concurrentCalls = 0;
  const concurrentResolver = async () => {
    concurrentCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 40));
    return { thread: validThread(concurrentThreadId, "Notification scope coalescing") };
  };
  const concurrentResults = await Promise.all([
    shouldNotifyMainThread(eventFor(concurrentThreadId), concurrentResolver),
    shouldNotifyMainThread(eventFor(concurrentThreadId), concurrentResolver),
  ]);
  await shouldNotifyMainThread(eventFor(concurrentThreadId), concurrentResolver);

  const failedThreadId = `e2e-notification-scope-failure-${Date.now()}`;
  let failedCalls = 0;
  const failedResolver = async () => {
    failedCalls += 1;
    throw new Error("synthetic scope failure");
  };
  const failedResults = await Promise.all([
    shouldNotifyMainThread(eventFor(failedThreadId), failedResolver),
    shouldNotifyMainThread(eventFor(failedThreadId), failedResolver),
  ]);
  const retryResult = await shouldNotifyMainThread(eventFor(failedThreadId), failedResolver);

  return {
    concurrentCalls,
    concurrentResults,
    failedCalls,
    failedResults,
    retryResult,
  };
});

function eventFor(threadId: string): GatewayEvent {
  return {
    id: 1,
    hostId: 1,
    threadId,
    method: "turn/completed",
    payload: { method: "turn/completed", params: {} },
    createdAt: new Date().toISOString(),
  };
}

function validThread(id: string, name: string) {
  return {
    id,
    extra: null,
    sessionId: id,
    forkedFromId: null,
    parentThreadId: null,
    preview: "",
    ephemeral: false,
    section: null,
    sectionEnteredAt: null,
    projectId: null,
    historyMode: "paginated" as const,
    modelProvider: "openai",
    createdAt: 1,
    updatedAt: 1,
    recencyAt: 1,
    status: { type: "idle" as const },
    path: null,
    cwd: "/tmp",
    cliVersion: "e2e",
    source: "cli" as const,
    canAcceptDirectInput: true,
    threadSource: "cli",
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name,
    turns: [],
  };
}
