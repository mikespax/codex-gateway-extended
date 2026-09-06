import { getValidatedQuery, createError } from "h3";
import type { ThreadMoveReadiness } from "~~/shared/types";
import {
  defineGatewayEventHandler,
  setGatewayRequestLogContext,
} from "../../../utils/gateway/http/errors";
import { requireRecord } from "../../../utils/gateway/http/validation/common";
import { threadMoveReadinessSchema } from "../../../utils/gateway/http/validation/threads";
import { hostStore } from "../../../utils/gateway/state/hosts";
import { remoteWorkspaceReadiness } from "../../../utils/gateway/infra/host-services";
import type { ResolvedSourceWorkspace } from "../../../utils/gateway/infra/git/remote-workspace-readiness";
import { threadBroker } from "../../../utils/gateway/runtime/broker";

export default defineGatewayEventHandler(async (event): Promise<ThreadMoveReadiness> => {
  const input = await getValidatedQuery(event, (query) => threadMoveReadinessSchema.parse(query));
  const sourceHost = requireRecord(
    hostStore.getWithSecret(input.sourceHostId),
    "Source host not found",
  );
  const targetHost = requireRecord(
    hostStore.getWithSecret(input.targetHostId),
    "Target host not found",
  );
  setGatewayRequestLogContext(event, "threads/move/readiness", {
    sourceHostId: sourceHost.id,
    targetHostId: targetHost.id,
    sourceThreadId: input.sourceThreadId,
  });

  // The app-server is authoritative for cwd. Do not trust the sidebar's cached project/cwd
  // metadata when deciding whether a continuation can safely run elsewhere.
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
  const targetCwd = input.targetCwd.trim();
  const [sourceWorkspace, target] = await Promise.all([
    remoteWorkspaceReadiness.resolveSourceWorkspace(
      sourceHost,
      sourceCwd,
      sourceOpen.project?.remotePath ?? null,
    ),
    remoteWorkspaceReadiness.inspect(targetHost, targetCwd),
  ]);
  const source = sourceWorkspace.readiness;

  let status: ThreadMoveReadiness["status"];
  if (source.availability === "missing") {
    status = "source_workspace_missing";
  } else if (target.availability === "missing") {
    status = "target_workspace_missing";
  } else if (source.availability === "notGit") {
    status = "source_not_git";
  } else if (target.availability === "notGit") {
    status = "target_not_git";
  } else if (
    source.repositoryIdentity === null ||
    target.repositoryIdentity === null ||
    source.repositoryIdentity !== target.repositoryIdentity
  ) {
    status = "repository_mismatch";
  } else if (source.headCommit === null) {
    status = "source_commit_missing_on_target";
  } else if (
    !(await remoteWorkspaceReadiness.containsCommit(
      targetHost,
      target.repositoryRoot,
      source.headCommit,
    ))
  ) {
    status = "source_commit_missing_on_target";
  } else {
    status = "ready";
  }

  return {
    status,
    source: { hostId: sourceHost.id, threadId: input.sourceThreadId, cwd: sourceCwd },
    target: { hostId: targetHost.id, cwd: targetCwd },
    ...sourceWorkspaceMetadata(sourceWorkspace, targetHost.name),
  };
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
