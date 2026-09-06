import { Agent } from "agent-base";
import type { Duplex } from "node:stream";

export class BrowserPreviewHttpAgent extends Agent {
  constructor(private readonly connectUpstream: () => Promise<Duplex>) {
    // This is one bounded HTTP pool per preview session. Resource count does not determine the
    // number of SSH channels: Node queues requests above maxSockets and keeps at most two idle
    // channels. Every channel is still multiplexed over the one shared ssh2 Client.
    super({ keepAlive: true, maxSockets: 6, maxFreeSockets: 2 });
  }

  override async connect() {
    return decorateSshHttpStream(await this.connectUpstream());
  }
}

function decorateSshHttpStream(stream: Duplex) {
  // Follow ssh2's official HTTPAgent adapter. ClientChannel implements Duplex but not the
  // net.Socket controls that Node's keep-alive lifecycle invokes. Supplying these no-op controls
  // lets the standard Agent pool and reuse channels without pretending to configure TCP beneath
  // SSH. Do not disable pooling here: that would open one forwardOut channel per page resource.
  return Object.assign(stream, {
    setKeepAlive: noopSocketControl,
    setNoDelay: noopSocketControl,
    setTimeout: noopSocketControl,
    ref: noopSocketControl,
    unref: noopSocketControl,
    destroySoon: () => stream.destroy(),
  });
}

function noopSocketControl() {}
