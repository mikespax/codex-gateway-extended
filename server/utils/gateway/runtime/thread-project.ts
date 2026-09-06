import { projectStore } from "../state/projects";
import { threadMetadataStore } from "../state/thread-metadata";

export function resolveThreadProject(
  hostId: number,
  projectId: number,
  threadId: string,
  requestCwd?: string | null,
) {
  const requestedCwd = nonEmptyPath(requestCwd);
  if (requestedCwd !== null) {
    const requested = projectStore
      .list(hostId)
      .find((project) => project.remotePath === requestedCwd);
    if (requested !== undefined) return requested;
    throw new Error(`Project path ${requestedCwd} is not registered for host ${hostId}`);
  }
  const selected = projectStore.get(projectId);
  if (requestedCwd === null && selected?.hostId === hostId) return selected;

  // Browser tabs may retain a project id after navigating between hosts. Thread metadata is
  // host-scoped and therefore provides the safe recovery path for an already-open thread.
  const metadataCwd = threadMetadataStore.get(hostId, threadId)?.cwd;
  const cwd = nonEmptyPath(metadataCwd);
  if (cwd !== null) return projectStore.ensureForPath(hostId, cwd);

  throw new Error(`Project ${projectId} does not belong to host ${hostId}`);
}

function nonEmptyPath(value: unknown) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}
