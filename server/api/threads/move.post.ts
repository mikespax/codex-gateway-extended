import { randomUUID } from "node:crypto";
import { createError, readValidatedBody } from "h3";
import type {
  ThreadHistoryItem,
  ThreadHistoryStatus,
  ThreadMoveResult,
  ThreadTimelineHistoryState,
} from "~~/shared/types";
import { recordFromUnknown } from "~~/shared/utils/records";
import { threadBroker } from "../../utils/gateway/runtime/broker";
import { setGatewayRequestLogContext } from "../../utils/gateway/http/errors";
import { defineGatewayConfigMutationHandler } from "../../utils/gateway/http/config-mutation";
import { remoteFiles } from "../../utils/gateway/infra/host-services";
import { requireRecord } from "../../utils/gateway/http/validation/common";
import { threadMoveSchema } from "../../utils/gateway/http/validation/threads";
import { hostStore } from "../../utils/gateway/state/hosts";
import { projectStore } from "../../utils/gateway/state/projects";
import { userConfigMutationService } from "../../utils/gateway/config/user-config-mutation-service";

const HANDOFF_CHAR_LIMIT = 24_000;

export default defineGatewayConfigMutationHandler(async (event): Promise<ThreadMoveResult> => {
  const input = await readValidatedBody(event, (body) => threadMoveSchema.parse(body));
  const sourceHost = requireRecord(
    hostStore.getWithSecret(input.sourceHostId),
    "Source host not found",
  );
  const targetHost = requireRecord(
    hostStore.getWithSecret(input.targetHostId),
    "Target host not found",
  );
  setGatewayRequestLogContext(event, "threads/move", {
    sourceHostId: sourceHost.id,
    targetHostId: targetHost.id,
    sourceThreadId: input.sourceThreadId,
    sourceProjectId: input.sourceProjectId ?? null,
    targetProjectId: input.targetProjectId ?? null,
  });

  // The source project ID is client-supplied metadata and may be stale after a host/config
  // refresh. It is only an optimization for opening the source thread; if it no longer exists or
  // belongs to another host, let the source app-server provide the thread's current cwd instead.
  // Target project selection remains strict below so a project can never cross host boundaries.
  const sourceProject = sourceProjectForHost(input.sourceProjectId, sourceHost.id);
  const target = resolveTargetProject(input.targetProjectId, input.targetCwd, targetHost.id);

  // Do this before creating a target thread. A handoff must never manufacture a thread in a
  // directory that is absent on the target machine, because that leaves a misleading migration
  // artifact which cannot safely continue the source work.
  const targetDirectory = await remoteFiles.inspectProjectDirectories(targetHost, [
    target.remotePath,
  ]);
  if (targetDirectory.get(target.remotePath.trim()) !== "available") {
    throw createError({
      statusCode: 400,
      statusMessage: "The target working directory is unavailable on the selected host",
    });
  }
  const targetProject =
    target.project ??
    userConfigMutationService.commit(event.context.auth!.user.id, () =>
      projectStore.create({
        hostId: targetHost.id,
        name: target.name,
        remotePath: target.remotePath,
      }),
    );

  // A running thread owns active tool calls and cannot be safely detached from its controller.
  // Requiring a terminal source state prevents duplicate sends and leaves the original thread
  // authoritative if the user needs to stop it first.
  const sourceStatus = await threadBroker.refreshThreadRuntimeStatus(
    sourceHost,
    input.sourceThreadId,
  );
  if (sourceStatus.status === "running") {
    throw createError({
      statusCode: 409,
      statusMessage: "Stop the source thread before moving it",
    });
  }

  const sourceOpen = await threadBroker.openThread(
    sourceHost,
    input.sourceThreadId,
    sourceProject?.id ?? null,
    100,
    undefined,
    sourceProject?.remotePath ?? null,
  );
  const sourceTitle = titleForThread(sourceOpen.thread, input.sourceThreadId);
  const sourceCwd = sourceProject?.remotePath ?? sourceOpen.thread.cwd;
  const handoff = buildHandoffMessage({
    sourceHostName: sourceHost.name,
    sourceTitle,
    sourceProjectName: sourceProject?.name ?? sourceOpen.project?.name ?? null,
    sourceCwd,
    targetHostName: targetHost.name,
    targetProjectName: targetProject.name,
    targetCwd: targetProject.remotePath,
    history: sourceOpen.history,
  });

  const settings = sourceOpen.threadSettings ?? {};
  const started = await threadBroker.startThread(
    targetHost,
    compactRecord({
      cwd: targetProject.remotePath,
      model: settings.model,
      effort: settings.effort,
      serviceTier: settings.serviceTier,
      approvalPolicy: settings.approvalPolicy,
    }),
    targetProject.id,
  );
  const targetThreadId = String(started.thread.id);

  await threadBroker.startTurn(targetHost, targetThreadId, {
    text: handoff,
    cwd: targetProject.remotePath,
    clientUserMessageId: `gateway-move-${randomUUID()}`,
    model: settings.model,
    effort: settings.effort,
    serviceTier: settings.serviceTier,
    approvalPolicy: settings.approvalPolicy,
    collaborationMode: settings.collaborationMode,
    images: [],
    files: [],
  });

  // Naming is best effort. The handoff has already been accepted at this point, so a naming RPC
  // failure must not make the caller retry and create a second target thread.
  try {
    await threadBroker.renameThread(targetHost, targetThreadId, sourceTitle);
  } catch (error) {
    console.warn("[gateway] moved thread was created but could not be renamed", {
      sourceHostId: sourceHost.id,
      sourceThreadId: input.sourceThreadId,
      targetHostId: targetHost.id,
      targetThreadId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return {
    source: {
      hostId: sourceHost.id,
      threadId: input.sourceThreadId,
    },
    target: {
      hostId: targetHost.id,
      projectId: targetProject.id,
      threadId: targetThreadId,
      title: sourceTitle,
      cwd: targetProject.remotePath,
    },
  };
});

function projectForHost(projectId: number | undefined, hostId: number, label: string) {
  if (projectId === undefined) return null;
  const project = requireRecord(projectStore.get(projectId), `${label} not found`);
  if (project.hostId !== hostId) {
    throw createError({ statusCode: 400, statusMessage: `${label} belongs to another host` });
  }
  return project;
}

function sourceProjectForHost(projectId: number | undefined, hostId: number) {
  if (projectId === undefined) return null;
  const project = projectStore.get(projectId);
  if (project === null || project.hostId !== hostId) return null;
  return project;
}

function resolveTargetProject(
  projectId: number | undefined,
  requestedCwd: string | null | undefined,
  hostId: number,
) {
  const selected = projectForHost(projectId, hostId, "Target project");
  if (selected !== null) {
    return { project: selected, name: selected.name, remotePath: selected.remotePath };
  }

  const cwd = requestedCwd?.trim() ?? "";
  if (cwd !== "") {
    const existing = projectStore.list(hostId).find((project) => project.remotePath === cwd);
    const name = cwd.split("/").filter(Boolean).at(-1) ?? cwd;
    return { project: existing ?? null, name, remotePath: cwd };
  }

  const firstConfiguredProject = projectStore.list(hostId)[0];
  if (firstConfiguredProject !== undefined) {
    return {
      project: firstConfiguredProject,
      name: firstConfiguredProject.name,
      remotePath: firstConfiguredProject.remotePath,
    };
  }
  throw createError({
    statusCode: 400,
    statusMessage: "Target host has no project; choose a target working directory",
  });
}

function compactRecord(values: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(values).filter(
      ([, value]) => value !== null && value !== undefined && value !== "",
    ),
  );
}

function titleForThread(
  thread: { title?: string | null; name?: string | null; preview?: string | null },
  fallback: string,
) {
  for (const value of [thread.title, thread.name, thread.preview]) {
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return fallback;
}

function buildHandoffMessage(input: {
  sourceHostName: string;
  sourceTitle: string;
  sourceProjectName: string | null;
  sourceCwd: string;
  targetHostName: string;
  targetProjectName: string;
  targetCwd: string;
  history: ThreadTimelineHistoryState;
}) {
  const lines = [
    "Continue this Codex conversation after a Gateway host migration.",
    "",
    "Migration metadata:",
    `- Original title: ${input.sourceTitle}`,
    `- Source host: ${input.sourceHostName}`,
    `- Source project: ${input.sourceProjectName ?? "unconfigured"}`,
    `- Source working directory: ${input.sourceCwd}`,
    `- Target host: ${input.targetHostName}`,
    `- Target project: ${input.targetProjectName}`,
    `- Target working directory: ${input.targetCwd}`,
    "",
    "Reconciliation requirements:",
    "- The original thread remains on the source host as the historical record.",
    "- Active tool calls, subprocesses, approvals, and in-memory state are not transferable.",
    "- Verify the target working directory, repository branch, local files, and running services before continuing.",
    "- Use the transcript below as context, then verify current state on this host rather than assuming source files or processes exist here.",
    "",
    "Prior conversation transcript:",
    formatHistory(input.history),
  ];
  return truncateHandoff(lines.join("\n"));
}

function formatHistory(history: ThreadTimelineHistoryState) {
  const turns = history.thread.turns ?? [];
  if (turns.length === 0) return "(No transcript was available in the loaded history page.)";
  const chunks: string[] = [];
  turns.forEach((turn, index) => {
    const items = turn.items ?? [];
    const turnLines = items.flatMap((item) => {
      const text = conversationTextFromItem(item);
      if (text === "") return [];
      const type = typeof item.type === "string" ? item.type : "event";
      const role = type === "userMessage" ? "User" : "Agent";
      return [`${role}:`, text];
    });
    if (turnLines.length > 0) {
      const status = statusText(turn.status);
      chunks.push(`Turn ${index + 1}${status === null ? "" : ` (${status})`}:`, ...turnLines);
    }
  });
  return chunks.length > 0
    ? chunks.join("\n")
    : "(No user-visible text was available in the loaded history page.)";
}

function conversationTextFromItem(item: ThreadHistoryItem) {
  // A host handoff must contain only the visible conversation, never commands, tool output,
  // diffs, attachments, paths, or arbitrary result payloads. Those can be sensitive and are not
  // reliable state on another host in any case.
  if (item.type !== "userMessage" && item.type !== "agentMessage") return "";
  const chunks: string[] = [];
  if (typeof item.text === "string" && item.text.trim() !== "") chunks.push(item.text.trim());
  const nested = conversationContentText(item.content);
  if (nested !== "") chunks.push(nested);
  return [...new Set(chunks)].join("\n");
}

function conversationContentText(value: unknown, depth = 0): string {
  if (depth > 4 || value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value))
    return value
      .map((entry) => conversationContentText(entry, depth + 1))
      .filter(Boolean)
      .join("\n");
  if (typeof value !== "object") return "";
  const record = recordFromUnknown(value);
  if (record === null) return "";
  const text = typeof record.text === "string" ? record.text.trim() : "";
  const nested = conversationContentText(record.content, depth + 1);
  return [text, nested].filter(Boolean).join("\n");
}

function statusText(status: ThreadHistoryStatus) {
  if (typeof status === "string" && status.trim() !== "") return status;
  if (status !== null && typeof status === "object" && typeof status.type === "string") {
    return status.type;
  }
  return null;
}

function truncateHandoff(value: string) {
  if (value.length <= HANDOFF_CHAR_LIMIT) return value;
  const marker =
    "\n\n[Transcript truncated by Gateway; the original source thread remains available.]";
  return `${value.slice(0, HANDOFF_CHAR_LIMIT - marker.length)}${marker}`;
}
