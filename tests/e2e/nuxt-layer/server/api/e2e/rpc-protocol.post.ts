import type { RpcEnvelope } from "~~/shared/types";
import { CodexRpcClient } from "../../../../../../server/utils/gateway/infra/rpc/rpc";
import type {
  CodexRpcTransportOptions,
  RpcTransport,
} from "../../../../../../server/utils/gateway/infra/rpc/rpc-transport";
import { defaultGatewayHost } from "../../../../fixtures/thread-history";

class ProtocolTestTransport implements RpcTransport {
  constructor(private readonly options: CodexRpcTransportOptions) {}

  async connect() {}

  send(message: RpcEnvelope) {
    if (message.method === "initialize" && message.id !== undefined) {
      queueMicrotask(() => this.options.onMessage(JSON.stringify({ id: message.id, result: {} })));
      return;
    }
    if (message.method === "initialized") return;
    queueMicrotask(() => this.options.onMessage("{}"));
  }

  close() {}
}

export default defineEventHandler(async () => {
  const client = new CodexRpcClient(
    {
      ...defaultGatewayHost(),
      name: "protocol-test",
      sshHost: "protocol-test.invalid",
      authMode: "agent",
    },
    {
      skipVersionCheck: true,
      transportFactory: (_host, options) => new ProtocolTestTransport(options),
    },
  );
  let closeCount = 0;
  client.on("close", () => {
    closeCount += 1;
  });
  await client.connect();
  const startedAt = Date.now();
  let errorMessage = "";
  try {
    await client.request("thread/list", {}, 5_000);
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
  }
  return { closeCount, elapsedMs: Date.now() - startedAt, errorMessage };
});
