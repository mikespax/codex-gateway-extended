import { getValidatedQuery } from "h3";
import { z } from "zod";
import { defineGatewayEventHandler } from "../../utils/gateway/http/errors";
import { projectStore } from "../../utils/gateway/state/projects";

const querySchema = z.object({
  hostId: z.coerce.number().int().positive().optional(),
});

export default defineGatewayEventHandler(async (event) => {
  const query = await getValidatedQuery(event, (value) => querySchema.parse(value));
  return projectStore.list(query.hostId);
});
