import { createError, readValidatedBody } from "h3";
import type { ThreadNativeMigrationResult } from "~~/shared/types";
import {
  defineGatewayEventHandler,
  setGatewayRequestLogContext,
} from "../../utils/gateway/http/errors";
import { threadNativeMigrationSchema } from "../../utils/gateway/http/validation/threads";
import { requireRecord } from "../../utils/gateway/http/validation/common";
import { hostStore } from "../../utils/gateway/state/hosts";
import { threadBroker } from "../../utils/gateway/runtime/broker";
import { remoteFiles, sshConnections, codexRuntime } from "../../utils/gateway/infra/host-services";
import {
  NativeThreadMigrationError,
  NativeThreadMigrationService,
} from "../../utils/gateway/infra/codex/native-thread-migration";

/**
 * Explicit full/native rollout migration. The existing /api/threads/move route remains the
 * transcript handoff and is deliberately not reused here.
 */
export default defineGatewayEventHandler(async (event): Promise<ThreadNativeMigrationResult> => {
  const input = await readValidatedBody(event, (body) => threadNativeMigrationSchema.parse(body));
  const sourceHost = requireRecord(
    hostStore.getWithSecret(input.sourceHostId),
    "Source host not found",
  );
  const targetHost = requireRecord(
    hostStore.getWithSecret(input.targetHostId),
    "Target host not found",
  );
  setGatewayRequestLogContext(event, "threads/native-migrate", {
    sourceHostId: sourceHost.id,
    targetHostId: targetHost.id,
    sourceThreadId: input.sourceThreadId,
  });
  try {
    return await new NativeThreadMigrationService({
      ssh: sshConnections,
      remoteFiles,
      threadBroker,
      codexRuntime,
    }).migrate(sourceHost, targetHost, {
      sourceThreadId: input.sourceThreadId,
      sourceRolloutPath: input.sourceRolloutPath,
      targetCwd: input.targetCwd,
    });
  } catch (error) {
    if (!(error instanceof NativeThreadMigrationError)) throw error;
    const routed = createError({ statusCode: error.statusCode, statusMessage: error.message });
    Object.assign(routed, { code: error.code });
    throw routed;
  }
});
