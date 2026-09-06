import { createHmac, randomBytes, randomUUID } from "node:crypto";
import type { Duplex } from "node:stream";
import type { BrowserPreviewHttpAgent } from "./browser-preview-http-agent";
import type {
  BrowserPreviewSessionSnapshot,
  BrowserPreviewTarget,
  HostRecord,
} from "~~/shared/types";
import { firstNonEmptyString, trimmedOrFallback } from "~~/shared/utils/strings";

const TICKET_TTL_MS = 60_000;

export interface BrowserPreviewSession {
  sessionId: string;
  ownerId: string;
  userId: number;
  host: HostRecord;
  target: URL;
  targetConfig: BrowserPreviewTarget;
  previewOrigin: string;
  cookieToken: string;
  ticket: string;
  ticketExpiresAt: number;
  status: "open" | "closed";
  sockets: Set<Duplex>;
  agent: BrowserPreviewHttpAgent | null;
}

export class BrowserPreviewManager {
  private sessions = new Map<string, BrowserPreviewSession>();
  private sessionsByCookie = new Map<string, BrowserPreviewSession>();
  private tickets = new Map<string, BrowserPreviewSession>();

  open(ownerId: string, userId: number, host: HostRecord, input: BrowserPreviewTarget) {
    const target = normalizeTarget(input.targetUrl);
    const sessionId = randomUUID();
    const ticket = randomBytes(32).toString("base64url");
    const cookieToken = randomBytes(32).toString("base64url");
    // Each preview session needs its own origin. A host + target origin is not unique enough:
    // opening two panels for the same remote service would make their HttpOnly cookies replace
    // each other and route one iframe through the other panel's SSH session.
    const previewOrigin = previewOriginFor(userId, host.id, target, sessionId);
    const session: BrowserPreviewSession = {
      sessionId,
      ownerId,
      userId,
      host,
      target,
      targetConfig: { ...input, targetUrl: target.href },
      previewOrigin,
      cookieToken,
      ticket,
      ticketExpiresAt: Date.now() + TICKET_TTL_MS,
      status: "open",
      sockets: new Set(),
      agent: null,
    };
    this.sessions.set(sessionId, session);
    this.tickets.set(ticket, session);
    return this.snapshot(session);
  }

  exchangeTicket(
    hostname: string,
    ticket: string,
    sessionId: string,
    cookieToken: string | undefined,
  ) {
    const session = this.tickets.get(ticket);
    if (session !== undefined) {
      this.tickets.delete(ticket);
      if (
        session.sessionId !== sessionId ||
        session.status !== "open" ||
        session.ticketExpiresAt < Date.now() ||
        new URL(session.previewOrigin).hostname !== hostname
      ) {
        return null;
      }
      this.sessionsByCookie.set(session.cookieToken, session);
      return { cookieToken: session.cookieToken, path: initialPath(session.target) };
    }

    // Dockview may destroy and recreate an iframe while moving or restoring a panel. The iframe
    // then reloads its original bootstrap URL even though that one-time ticket was already
    // exchanged. Re-entry is allowed only when the browser presents the HttpOnly cookie issued by
    // the first exchange and all session coordinates still match. Do not make tickets reusable:
    // without the cookie, a consumed or expired ticket remains invalid.
    const cookieSession = this.resolve(hostname, cookieToken);
    if (
      cookieSession === null ||
      cookieSession.sessionId !== sessionId ||
      cookieSession.ticket !== ticket
    ) {
      return null;
    }
    return {
      cookieToken: cookieSession.cookieToken,
      path: initialPath(cookieSession.target),
    };
  }

  resolve(hostname: string, cookieToken: string | undefined) {
    if (cookieToken === undefined || cookieToken === "") return null;
    const session = this.sessionsByCookie.get(cookieToken);
    if (session === undefined || session.status !== "open") return null;
    return new URL(session.previewOrigin).hostname === hostname ? session : null;
  }

  resolveWebSocket(hostname: string, cookieToken: string | undefined) {
    return this.resolve(hostname, cookieToken);
  }

  setInsecureTls(userId: number, sessionId: string, allowInsecureTls: boolean) {
    const session = this.require(userId, sessionId);
    session.targetConfig.allowInsecureTls = allowInsecureTls;
    return this.snapshot(session);
  }

  trackSocket(session: BrowserPreviewSession, socket: Duplex) {
    session.sockets.add(socket);
    socket.once("close", () => session.sockets.delete(socket));
  }

  agentFor(
    session: BrowserPreviewSession,
    create: () => BrowserPreviewHttpAgent,
  ): BrowserPreviewHttpAgent {
    session.agent ??= create();
    return session.agent;
  }

  close(userId: number, sessionId: string) {
    this.closeSession(this.require(userId, sessionId));
  }

  closeOwner(ownerId: string) {
    for (const session of this.sessions.values()) {
      if (session.ownerId === ownerId) this.closeSession(session);
    }
  }

  closeHost(userId: number, hostId: number) {
    for (const session of this.sessions.values()) {
      if (session.userId === userId && session.host.id === hostId) this.closeSession(session);
    }
  }

  private closeSession(session: BrowserPreviewSession) {
    if (session.status === "closed") return;
    session.status = "closed";
    this.sessions.delete(session.sessionId);
    this.sessionsByCookie.delete(session.cookieToken);
    this.tickets.delete(session.ticket);
    session.agent?.destroy();
    session.agent = null;
    for (const socket of session.sockets) socket.destroy();
    session.sockets.clear();
  }

  private require(userId: number, sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (session === undefined || session.userId !== userId || session.status !== "open") {
      throw new Error("Browser preview session not found");
    }
    return session;
  }

  private snapshot(session: BrowserPreviewSession): BrowserPreviewSessionSnapshot {
    return {
      ...session.targetConfig,
      sessionId: session.sessionId,
      previewOrigin: session.previewOrigin,
      bootstrapUrl: `${session.previewOrigin}/_gateway/preview/bootstrap?sessionId=${encodeURIComponent(session.sessionId)}#${session.ticket}`,
      status: session.status,
    };
  }
}

export const browserPreviewManager = new BrowserPreviewManager();
export type ActiveBrowserPreviewSession = NonNullable<ReturnType<BrowserPreviewManager["resolve"]>>;

function normalizeTarget(value: string) {
  const withProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `http://${value}`;
  const target = new URL(withProtocol);
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    throw new Error("Browser preview supports only HTTP and HTTPS URLs");
  }
  target.username = "";
  target.password = "";
  return target;
}

function previewHostname(userId: number, hostId: number, target: URL, sessionId: string) {
  const secret = firstNonEmptyString([
    process.env.BROWSER_PREVIEW_SECRET,
    process.env.CODEX_GATEWAY_CONFIG_SECRET,
    process.env.NUXT_SESSION_PASSWORD,
  ]);
  if (secret === null) throw new Error("Browser preview secret is not configured");
  const digest = createHmac("sha256", secret)
    .update(`${userId}:${hostId}:${target.origin}:${sessionId}`)
    .digest("hex")
    .slice(0, 32);
  const domain = trimmedOrFallback(process.env.BROWSER_PREVIEW_DOMAIN, "cloudawn.top");
  return `p-${digest}.${domain}`;
}

export function isBrowserPreviewHostname(hostname: string) {
  const domain = trimmedOrFallback(process.env.BROWSER_PREVIEW_DOMAIN, "cloudawn.top");
  return new RegExp(`^p-[0-9a-f]{32}\\.${escapeRegExp(domain)}$`, "i").test(hostname);
}

function previewOriginFor(userId: number, hostId: number, target: URL, sessionId: string) {
  const scheme = trimmedOrFallback(process.env.BROWSER_PREVIEW_SCHEME, "https");
  const port = process.env.BROWSER_PREVIEW_PUBLIC_PORT;
  return `${scheme}://${previewHostname(userId, hostId, target, sessionId)}${port === undefined || port === "" ? "" : `:${port}`}`;
}

function initialPath(target: URL) {
  return `${target.pathname}${target.search}${target.hash}`;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
