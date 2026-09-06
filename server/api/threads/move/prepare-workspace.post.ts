import { createError, readValidatedBody } from "h3";
import { posix } from "node:path";
import type { ThreadMoveReadiness } from "~~/shared/types";
import {
  defineGatewayEventHandler,
  setGatewayRequestLogContext,
} from "../../../utils/gateway/http/errors";
import { threadMovePrepareWorkspaceSchema } from "../../../utils/gateway/http/validation/threads";
import { requireRecord } from "../../../utils/gateway/http/validation/common";
import { hostStore } from "../../../utils/gateway/state/hosts";
import { remoteWorkspaceReadiness } from "../../../utils/gateway/infra/host-services";
import type { ResolvedSourceWorkspace } from "../../../utils/gateway/infra/git/remote-workspace-readiness";
import { WorkspacePreparationError } from "../../../utils/gateway/infra/git/remote-workspace-readiness";
import { threadBroker } from "../../../utils/gateway/runtime/broker";

export default defineGatewayEventHandler(async (event): Promise<ThreadMoveReadiness> => {
  const input = await readValidatedBody(event, (body) =>
    threadMovePrepareWorkspaceSchema.parse(body),
  );
  const sourceHost = requireRecord(
    hostStore.getWithSecret(input.sourceHostId),
    "Source host not found",
  );
  const targetHost = requireRecord(
    hostStore.getWithSecret(input.targetHostId),
    "Target host not found",
  );
  setGatewayRequestLogContext(event, "threads/move/prepare-workspace", {
    sourceHostId: sourceHost.id,
    targetHostId: targetHost.id,
    sourceThreadId: input.sourceThreadId,
  });

  const sourceOpen = await threadBroker.openThread(
    sourceHost,
    input.sourceThreadId,
    null,
    1,
    undefined,
    null,
  );
  const sourceCwd = sourceOpen.thread.cwd?.trim();
  if (sourceCwd === undefined || sourceCwd === "" || !sourceCwd.startsWith("/")) {
    throw createError({
      statusCode: 502,
      statusMessage: "The source thread did not provide an absolute working directory",
    });
  }

  try {
    const targetCwd = posix.normalize(input.targetCwd.trim());
    const prepared = await remoteWorkspaceReadiness.prepare(
      sourceHost,
      sourceCwd,
      sourceOpen.project?.remotePath ?? null,
      targetHost,
      targetCwd,
    );
    return {
      status: "ready",
      source: { hostId: sourceHost.id, threadId: input.sourceThreadId, cwd: sourceCwd },
      target: { hostId: targetHost.id, cwd: targetCwd },
      ...sourceWorkspaceMetadata(
        {
          kind: prepared.sourceWorkspaceKind,
          cwd: prepared.sourceWorkspaceCwd,
          readiness: prepared.source,
        },
        targetHost.name,
      ),
    };
  } catch (error) {
    if (error instanceof WorkspacePreparationError) {
      const statusCode = error.reason === "target_exists" ? 409 : 400;
      throw createError({ statusCode, statusMessage: error.message });
    }
    throw error;
  }
});

function sourceWorkspaceMetadata(source: ResolvedSourceWorkspace, targetHostName: string) {
  if (source.kind !== "operations_fallback") return {};
  const normalizedTargetName = targetHostName.trim().toLowerCase();
  return {
    sourceWorkspaceKind: source.kind,
    sourceWorkspaceCwd: source.cwd,
    recommendedTargetCwd:
      normalizedTargetName === "lenovo"
        ? "/root/stickerlight-ops"
        : normalizedTargetName === "mac"
          ? "/Users/Sparks/stickerlight-ops"
          : null,
  };
}
