import tls from "node:tls";
import type { Duplex } from "node:stream";
import WebSocket from "ws";
import { Agent } from "agent-base";
import type { ClientRequest } from "node:http";
import type { AgentConnectOpts } from "agent-base";
import { sshConnections } from "../infra/host-services";
import { browserPreviewManager, type BrowserPreviewSession } from "./browser-preview-manager";
import { BROWSER_PREVIEW_MAX_WEBSOCKET_PENDING_BYTES } from "./browser-preview-websocket-limits";

export class BrowserPreviewUpstreamConnector {
  async openSocket(session: BrowserPreviewSession): Promise<Duplex> {
    const channel = await sshConnections.openTcpChannel(session.host, {
      host: session.target.hostname,
      port: targetPort(session),
    });
    if (session.status !== "open") {
      channel.destroy();
      throw new Error("Browser preview session is closed");
    }
    if (session.target.protocol !== "https:") {
      browserPreviewManager.trackSocket(session, channel);
      return channel;
    }
    try {
      const socket = await openTlsSocket(session, channel);
      if (session.status !== "open") {
        socket.destroy();
        throw new Error("Browser preview session is closed");
      }
      browserPreviewManager.trackSocket(session, socket);
      return socket;
    } catch (error) {
      channel.destroy();
      throw error;
    }
  }

  async openWebSocket(
    session: BrowserPreviewSession,
    path: string,
    protocols: string[] | undefined,
    headers: Record<string, string>,
  ) {
    const socket = await this.openSocket(session);
    const protocol = session.target.protocol === "https:" ? "wss:" : "ws:";
    try {
      return new WebSocket(`${protocol}//${session.target.host}${path}`, protocols, {
        agent: new ExistingSocketAgent(socket),
        headers,
        maxPayload: BROWSER_PREVIEW_MAX_WEBSOCKET_PENDING_BYTES,
      });
    } catch (error) {
      socket.destroy();
      throw error;
    }
  }
}

export function browserPreviewTargetPort(session: BrowserPreviewSession) {
  return Number(
    session.target.port === ""
      ? session.target.protocol === "https:"
        ? 443
        : 80
      : session.target.port,
  );
}

export const browserPreviewUpstreamConnector = new BrowserPreviewUpstreamConnector();

function targetPort(session: BrowserPreviewSession) {
  return browserPreviewTargetPort(session);
}

function openTlsSocket(session: BrowserPreviewSession, channel: Duplex): Promise<Duplex> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      socket: channel,
      servername: session.target.hostname,
      rejectUnauthorized: session.targetConfig.allowInsecureTls !== true,
    });
    socket.once("secureConnect", () => resolve(socket));
    socket.once("error", reject);
  });
}

class ExistingSocketAgent extends Agent {
  constructor(private readonly socket: Duplex) {
    super();
  }

  connect(_request: ClientRequest, _options: AgentConnectOpts) {
    return this.socket;
  }
}
