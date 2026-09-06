import { getValidatedQuery } from "h3";
import { defineGatewayEventHandler } from "../../utils/gateway/http/errors";
import { threadMetadataListSchema } from "../../utils/gateway/http/validation/threads";
import { hostStore } from "../../utils/gateway/state/hosts";
import { threadMetadataStore } from "../../utils/gateway/state/thread-metadata";
import { requireRecord } from "../../utils/gateway/http/validation/common";

export default defineGatewayEventHandler(async (event) => {
  const query = await getValidatedQuery(event, (value) => threadMetadataListSchema.parse(value));
  requireRecord(hostStore.get(query.hostId), "Host not found");
  const requested = new Set(query.threadIds);
  return {
    data: threadMetadataStore.list(query.hostId).filter((thread) => requested.has(thread.id)),
  };
});
