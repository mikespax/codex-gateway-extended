import { readValidatedBody } from "h3";
import { defineGatewayEventHandler } from "../../utils/gateway/http/errors";
import { requireRecord } from "../../utils/gateway/http/validation/common";
import { threadStorageBatchSchema } from "../../utils/gateway/http/validation/threads";
import { hostStore } from "../../utils/gateway/state/hosts";
import { threadStorage } from "../../utils/gateway/infra/host-services";

/** Return bulk thread-size samples without making the sidebar wait on the initial thread list. */
export default defineGatewayEventHandler(async (event) => {
  const body = await readValidatedBody(event, (value) => threadStorageBatchSchema.parse(value));
  const host = requireRecord(hostStore.getWithSecret(body.hostId), "Host not found");
  const values = await threadStorage.scan(
    host,
    body.threads.map((thread) => ({ id: thread.threadId, path: thread.path ?? null })),
  );
  return {
    data: [...values].map(([threadId, threadBytes]) => ({ threadId, threadBytes })),
  };
});
