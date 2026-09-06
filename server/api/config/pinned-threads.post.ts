import { readValidatedBody } from "h3";
import { z } from "zod";
import { userConfigMutationService } from "../../utils/gateway/config/user-config-mutation-service";
import { defineGatewayConfigMutationHandler } from "../../utils/gateway/http/config-mutation";
import { pinnedThreadSchema } from "../../utils/gateway/http/validation/config";
import { runtimeConfigStore } from "../../utils/gateway/state/runtime-config";

const bodySchema = z.discriminatedUnion("pinned", [
  z.object({ pinned: z.literal(true), thread: pinnedThreadSchema }).strict(),
  z
    .object({
      pinned: z.literal(false),
      hostId: z.coerce.number().int().positive(),
      threadId: z.string().trim().min(1),
    })
    .strict(),
]);

export default defineGatewayConfigMutationHandler(async (event) => {
  const userId = event.context.auth!.user.id;
  const body = await readValidatedBody(event, (value) => bodySchema.parse(value));
  return userConfigMutationService.commit(userId, () => {
    const config = runtimeConfigStore.export();
    const hostId = body.pinned ? body.thread.hostId : body.hostId;
    const threadId = body.pinned ? body.thread.threadId : body.threadId;
    const remaining = config.pinnedThreads.filter(
      (thread) => thread.hostId !== hostId || thread.threadId !== threadId,
    );
    const nextThread = body.pinned
      ? { ...body.thread, projectId: body.thread.projectId ?? null }
      : null;
    runtimeConfigStore.replacePinnedThreads(nextThread ? [nextThread, ...remaining] : remaining);
    return runtimeConfigStore.export();
  });
});
