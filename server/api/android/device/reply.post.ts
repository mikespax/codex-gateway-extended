import { createError, readValidatedBody, setResponseStatus } from "h3";
import { z } from "zod";
import {
  ensureUserConfigLoaded,
  defineGatewayEventHandler,
} from "../../../utils/gateway/http/errors";
import { requireAndroidDevice } from "../../../utils/gateway/notifications/android-device-auth";
import { androidDeviceRepository } from "../../../utils/gateway/notifications/android-device-repository";
import { runWithGatewayUser } from "../../../utils/gateway/state/memory";
import { hostStore } from "../../../utils/gateway/state/hosts";
import { projectStore } from "../../../utils/gateway/state/projects";
import { threadMetadataStore } from "../../../utils/gateway/state/thread-metadata";
import { threadBroker } from "../../../utils/gateway/runtime/broker";

const bodySchema = z
  .object({
    notificationKey: z.string().trim().min(1).max(500),
    text: z.string().trim().min(1).max(10_000),
    clientMessageId: z.uuid(),
  })
  .strict();

export default defineGatewayEventHandler(async (event) => {
  const device = requireAndroidDevice(event);
  const body = await readValidatedBody(event, (value) => bodySchema.parse(value));
  const context = androidDeviceRepository.replyContext(device, body.notificationKey);
  if (context === null || context.target.kind !== "thread" || !context.replyAllowed) {
    throw createError({
      statusCode: 404,
      statusMessage: "Replyable notification not found or expired",
    });
  }
  const replyTarget = context.target;
  const claim = androidDeviceRepository.claimReply(
    device.id,
    body.notificationKey,
    body.clientMessageId,
  );
  if (claim === "accepted") return { accepted: true, duplicate: true };
  if (claim === "processing") {
    setResponseStatus(event, 202);
    return { accepted: false, processing: true };
  }

  try {
    await runWithGatewayUser(device.userId, async () => {
      ensureUserConfigLoaded(device.userId);
      const target = replyTarget;
      const host = hostStore.getWithSecret(target.hostId);
      if (host === null) {
        throw createError({ statusCode: 404, statusMessage: "Notification host not found" });
      }
      if (threadBroker.isThreadRunning(target.hostId, target.threadId)) {
        throw createError({
          statusCode: 409,
          statusMessage: "Thread is still running; wait for completion before replying",
        });
      }
      const project = replyProject(target.hostId, target.threadId, target.projectId);
      await threadBroker.startTurn(host, target.threadId, {
        text: body.text,
        cwd: project.remotePath,
        clientUserMessageId: `android-${device.id}-${body.clientMessageId}`,
        images: [],
        files: [],
        additionalContext: {},
      });
    });
    androidDeviceRepository.completeReply(device.id, body.notificationKey, body.clientMessageId);
    return { accepted: true, duplicate: false };
  } catch (error) {
    androidDeviceRepository.failReply(
      device.id,
      body.clientMessageId,
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  }
});

function replyProject(hostId: number, threadId: string, projectId: number | null) {
  if (projectId !== null) {
    const project = projectStore.get(projectId);
    if (project?.hostId === hostId) return project;
  }
  const cwd = threadMetadataStore.get(hostId, threadId)?.cwd?.trim() ?? "";
  if (cwd !== "") return projectStore.ensureForPath(hostId, cwd);
  throw createError({
    statusCode: 409,
    statusMessage: "Thread project is unavailable; open the thread in Gateway before replying",
  });
}
