import { getRouterParam, getValidatedQuery, setResponseHeader } from "h3";
import { z } from "zod";
import {
  defineGatewayEventHandler,
  setGatewayRequestLogContext,
} from "../../../utils/gateway/http/errors";
import { requireRecord } from "../../../utils/gateway/http/validation/common";
import { hostStore } from "../../../utils/gateway/state/hosts";
import { projectStore } from "../../../utils/gateway/state/projects";
import { projectFileIndex } from "../../../utils/gateway/project-files/project-file-index";

const querySchema = z.object({ q: z.string().max(500).default("") });

export default defineGatewayEventHandler(async (event) => {
  const projectId = z.coerce.number().int().positive().parse(getRouterParam(event, "id"));
  const query = await getValidatedQuery(event, (value) => querySchema.parse(value));
  const project = requireRecord(projectStore.get(projectId), "Project not found");
  const host = requireRecord(hostStore.getWithSecret(project.hostId), "Host not found");
  setGatewayRequestLogContext(event, "project file search", { hostId: host.id, projectId });
  const result = await projectFileIndex.search(host, project, query.q);
  setResponseHeader(event, "x-gateway-project-file-index", result.cacheState);
  return { files: result.files };
});
