import { createError, readValidatedBody, setResponseStatus } from "h3";
import { supervisorThreadMessageSchema } from "../../../utils/gateway/http/validation/supervisor";
import { threadBroker } from "../../../utils/gateway/runtime/broker";
import { hostStore } from "../../../utils/gateway/state/hosts";
import { projectStore } from "../../../utils/gateway/state/projects";
import { threadMetadataStore } from "../../../utils/gateway/state/thread-metadata";
import { defineSupervisorEventHandler } from "../../../utils/gateway/supervisor/http";
import { supervisorMessageRequestStore } from "../../../utils/gateway/supervisor/message-requests";
import type { SupervisorGrant } from "../../../utils/gateway/supervisor/grants";

const SUPERVISOR_CONTEXT =
  "This turn was submitted through a thread-scoped project-management supervisor. " +
  "The supervisor message does not itself authorize customer sends, terminal or file actions, " +
  "browser actions, interrupts, settings changes, goal changes, or thread deletion.";

export default defineSupervisorEventHandler(
  "thread.projectManagement.send",
  async (event, grant) => {
    const body = await readValidatedBody(event, (value) =>
      supervisorThreadMessageSchema.parse(value),
    );
    const host = hostStore.getWithSecret(grant.hostId);
    if (host === null) {
      throw createError({ statusCode: 404, statusMessage: "Supervisor host not found" });
    }
    const claim = supervisorMessageRequestStore.claim(grant.id, body.clientMessageId, body.text);
    if (claim === "conflict") {
      throw createError({
        statusCode: 409,
        statusMessage: "Client message ID was already used with different text",
      });
    }
    if (claim === "accepted") return { accepted: true, duplicate: true };
    if (claim === "processing") {
      setResponseStatus(event, 202);
      return { accepted: false, processing: true };
    }

    try {
      if (threadBroker.isThreadRunning(grant.hostId, grant.threadId)) {
        throw createError({
          statusCode: 409,
          statusMessage: "Supervised thread is running; wait for completion before sending",
        });
      }
      const project = supervisorProject(grant);
      const result = await threadBroker.startTurn(host, grant.threadId, {
        text: `[Supervisor coordination]\n\n${body.text}`,
        cwd: project.remotePath,
        clientUserMessageId: `supervisor-${grant.id}-${body.clientMessageId}`,
        images: [],
        files: [],
        additionalContext: {
          supervisor_scope: { value: SUPERVISOR_CONTEXT, kind: "application" },
        },
      });
      const turnId = result?.turn?.id ?? null;
      supervisorMessageRequestStore.accept(grant.id, body.clientMessageId, turnId);
      return { accepted: true, duplicate: false, turnId };
    } catch (error) {
      supervisorMessageRequestStore.fail(grant.id, body.clientMessageId);
      throw error;
    }
  },
);

function supervisorProject(grant: SupervisorGrant) {
  if (grant.projectId !== null) {
    const project = projectStore.get(grant.projectId);
    if (project?.hostId === grant.hostId) return project;
  }
  const cwd = threadMetadataStore.get(grant.hostId, grant.threadId)?.cwd?.trim() ?? "";
  if (cwd !== "") return projectStore.ensureForPath(grant.hostId, cwd);
  throw createError({
    statusCode: 409,
    statusMessage: "Supervised thread project is unavailable",
  });
}
