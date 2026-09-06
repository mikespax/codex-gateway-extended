import http, {
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { text as consumeText } from "node:stream/consumers";
import { z } from "zod";
import { browserPreviewEvents } from "./browser-preview-events";
import { BrowserPreviewHttpAgent } from "./browser-preview-http-agent";
import { browserPreviewManager, type BrowserPreviewSession } from "./browser-preview-manager";
import {
  browserPreviewTargetPort,
  browserPreviewUpstreamConnector,
} from "./browser-preview-upstream-connector";
import { runtimeLog } from "../runtime/runtime-log";

const BOOTSTRAP_PATH = "/_gateway/preview/bootstrap";
const SESSION_PATH = "/_gateway/preview/session";
const ticketRequestSchema = z.object({ ticket: z.string().min(1), sessionId: z.uuid() }).strict();

export async function handleBrowserPreviewRequest(
  request: IncomingMessage,
  response: ServerResponse,
) {
  try {
    const hostname = requestHostname(request);
    // Match only the pathname for Gateway-owned control routes. The bootstrap carries sessionId
    // in its query string, while ordinary preview requests must retain their complete URL when
    // forwarded upstream.
    const pathname = requestPathname(request);
    if (pathname === BOOTSTRAP_PATH && request.method === "GET") {
      serveBootstrap(response);
      return;
    }
    if (pathname === SESSION_PATH && request.method === "POST") {
      await exchangeTicket(request, response, hostname);
      return;
    }
    const session = browserPreviewManager.resolve(hostname, readCookie(request, authCookieName()));
    if (!session) {
      sendText(response, 401, "Browser preview session expired. Reopen the Browser panel.");
      return;
    }
    await proxyHttpRequest(session, request, response);
  } catch (error) {
    sendText(response, 502, errorMessage(error));
  }
}

async function proxyHttpRequest(
  session: BrowserPreviewSession,
  request: IncomingMessage,
  response: ServerResponse,
) {
  const headers = upstreamHeaders(session, request.headers);
  const agent = browserPreviewManager.agentFor(
    session,
    () => new BrowserPreviewHttpAgent(() => browserPreviewUpstreamConnector.openSocket(session)),
  );
  await new Promise<void>((resolve) => {
    let settled = false;
    let upstreamResponse: IncomingMessage | null = null;
    const finish = () => {
      if (settled) return;
      settled = true;
      request.off("aborted", abortUpstream);
      response.off("close", abortUpstream);
      resolve();
    };
    const abortUpstream = () => {
      if (response.writableFinished) {
        finish();
        return;
      }
      upstream.destroy(new Error("Browser preview downstream closed"));
      upstreamResponse?.destroy();
      finish();
    };
    const upstream = http.request(
      {
        method: request.method,
        path: browserPreviewRequestUrl(request),
        headers,
        agent,
        host: session.target.hostname,
        port: String(browserPreviewTargetPort(session)),
      },
      (incoming) => {
        upstreamResponse = incoming;
        publishUpstreamFailureResponse(session, request, incoming.statusCode ?? 502);
        const responseHeaders = { ...incoming.headers };
        rewriteLocation(session, responseHeaders);
        stripCookieDomains(responseHeaders);
        publishFramePolicy(session, responseHeaders);
        response.writeHead(incoming.statusCode ?? 502, responseHeaders);
        incoming.pipe(response);
        incoming.once("end", finish);
        incoming.once("close", finish);
      },
    );
    request.once("aborted", abortUpstream);
    response.once("close", abortUpstream);
    upstream.on("error", (error) => {
      logUpstreamFailure(session, request, error);
      if (!response.headersSent) sendText(response, 502, `Remote preview failed: ${error.message}`);
      else response.destroy(error);
      finish();
    });
    if (request.method === "GET" || request.method === "HEAD") upstream.end();
    else request.pipe(upstream);
  });
}

function publishUpstreamFailureResponse(
  session: BrowserPreviewSession,
  request: IncomingMessage,
  statusCode: number,
) {
  if (statusCode < 400) return;
  const method = request.method ?? "GET";
  const path = requestPathname(request);
  const destination = requestDestination(request);
  const failure = {
    statusCode,
    method,
    path,
    destination,
    occurredAt: new Date().toISOString(),
  };
  runtimeLog("browser preview upstream returned error", {
    userId: session.userId,
    hostId: session.host.id,
    hostName: session.host.name,
    projectId: session.targetConfig.projectId ?? null,
    threadId: session.targetConfig.threadId ?? null,
    sessionId: session.sessionId,
    targetOrigin: session.target.origin,
    ...failure,
  });
  // Do not filter on Sec-Fetch-Dest here. Reverse proxies are allowed to omit that optional header,
  // and production nginx does so today; treating `unknown` as non-critical hid the exact script
  // 404 that left the preview blank. The client bounds and deduplicates the per-session list.
  browserPreviewEvents.publish({
    type: "resource-failed",
    userId: session.userId,
    sessionId: session.sessionId,
    failure,
  });
}

function logUpstreamFailure(
  session: BrowserPreviewSession,
  request: IncomingMessage,
  error: Error,
) {
  runtimeLog("browser preview upstream failed", {
    userId: session.userId,
    hostId: session.host.id,
    hostName: session.host.name,
    sessionId: session.sessionId,
    targetOrigin: session.target.origin,
    requestMethod: request.method,
    requestPath: browserPreviewRequestUrl(request),
    message: error.message,
  });
}

function upstreamHeaders(session: BrowserPreviewSession, incoming: IncomingMessage["headers"]) {
  const headers: IncomingHttpHeaders = { ...incoming, host: session.target.host };
  delete headers["x-forwarded-host"];
  delete headers["x-forwarded-proto"];
  if (typeof headers.origin === "string" && headers.origin !== "") {
    headers.origin = session.target.origin;
  }
  if (typeof headers.referer === "string" && headers.referer !== "") {
    headers.referer = translatePreviewUrl(session, headers.referer);
  }
  headers.cookie = withoutPreviewCookie(headers.cookie);
  if (headers.cookie === undefined || headers.cookie === "") delete headers.cookie;
  return headers;
}

function withoutPreviewCookie(value: string | undefined) {
  return value
    ?.split(";")
    .map((cookie) => cookie.trim())
    .filter((cookie) => !cookie.startsWith(`${authCookieName()}=`))
    .join("; ");
}

function translatePreviewUrl(session: BrowserPreviewSession, value: string) {
  try {
    const url = new URL(value);
    return `${session.target.origin}${url.pathname}${url.search}`;
  } catch {
    return value;
  }
}

function rewriteLocation(session: BrowserPreviewSession, headers: http.OutgoingHttpHeaders) {
  if (typeof headers.location !== "string") return;
  try {
    const location = new URL(headers.location, session.target);
    if (location.origin === session.target.origin) {
      headers.location = `${session.previewOrigin}${location.pathname}${location.search}${location.hash}`;
    }
  } catch {}
}

function stripCookieDomains(headers: http.OutgoingHttpHeaders) {
  const cookies = headers["set-cookie"];
  if (cookies === undefined) return;
  const values = Array.isArray(cookies) ? cookies : [cookies];
  headers["set-cookie"] = values.map((cookie) => cookie.replace(/;\s*domain=[^;]+/gi, ""));
}

function publishFramePolicy(session: BrowserPreviewSession, headers: http.OutgoingHttpHeaders) {
  const xFrame = headers["x-frame-options"];
  if (typeof xFrame === "string" && !/^allowall$/i.test(xFrame)) {
    browserPreviewEvents.publish({
      type: "frame-policy",
      userId: session.userId,
      sessionId: session.sessionId,
      policy: "x-frame-options",
      value: xFrame,
    });
  }
  const csp = headers["content-security-policy"];
  if (typeof csp === "string" && /(?:^|;)\s*frame-ancestors\s+/i.test(csp)) {
    browserPreviewEvents.publish({
      type: "frame-policy",
      userId: session.userId,
      sessionId: session.sessionId,
      policy: "content-security-policy",
      value: csp,
    });
  }
}

function requestDestination(request: IncomingMessage) {
  const destination = request.headers["sec-fetch-dest"];
  return typeof destination === "string" && destination !== "" ? destination : "unknown";
}

async function exchangeTicket(
  request: IncomingMessage,
  response: ServerResponse,
  hostname: string,
) {
  const body = ticketRequestSchema.parse(JSON.parse(await consumeText(request)));
  const result = browserPreviewManager.exchangeTicket(
    hostname,
    body.ticket,
    body.sessionId,
    readCookie(request, authCookieName()),
  );
  if (result === null) {
    sendText(response, 401, "Invalid or expired browser preview ticket");
    return;
  }
  response.setHeader(
    "set-cookie",
    `${authCookieName()}=${result.cookieToken}; Path=/; HttpOnly;${
      process.env.BROWSER_PREVIEW_SCHEME === "http" ? "" : " Secure;"
    } SameSite=Lax`,
  );
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify({ path: result.path }));
}

function serveBootstrap(response: ServerResponse) {
  response.setHeader("content-type", "text/html; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.end(`<!doctype html><meta charset="utf-8"><title>Opening preview</title><script>
const ticket=location.hash.slice(1);const sessionId=new URL(location.href).searchParams.get('sessionId');location.hash='';fetch('${SESSION_PATH}',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ticket,sessionId})}).then(async r=>{if(!r.ok)throw new Error(await r.text());return r.json()}).then(({path})=>location.replace(path)).catch(error=>document.body.textContent=error.message)
</script>`);
}

function requestHostname(request: IncomingMessage) {
  return (String(request.headers.host ?? "").split(":", 1)[0] ?? "").toLowerCase();
}

function requestPathname(request: IncomingMessage) {
  return new URL(browserPreviewRequestUrl(request), "http://browser-preview.invalid").pathname;
}

function browserPreviewRequestUrl(request: IncomingMessage) {
  const original = request.headers["x-browser-preview-path"];
  return typeof original === "string" && original !== "" ? original : (request.url ?? "/");
}

export function readPreviewCookie(value: string | undefined) {
  return readCookieValue(value, authCookieName());
}

function readCookie(request: IncomingMessage, name: string) {
  return readCookieValue(request.headers.cookie, name);
}

function readCookieValue(value: string | undefined, name: string) {
  const match = value?.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match?.[1];
}

export function authCookieName() {
  return process.env.BROWSER_PREVIEW_SCHEME === "http"
    ? "gateway-preview"
    : "__Host-gateway-preview";
}

function sendText(response: ServerResponse, status: number, message: string) {
  if (response.headersSent) return;
  response.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  response.end(message);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
