import { getRequestHost } from "h3";
import { isBrowserPreviewHostname } from "../../utils/gateway/browser-preview/browser-preview-manager";
import { handleBrowserPreviewRequest } from "../../utils/gateway/browser-preview/browser-preview-proxy";

export default defineEventHandler(async (event) => {
  const hostname = getRequestHost(event, { xForwardedHost: false }).split(":", 1)[0]!.toLowerCase();
  if (!isBrowserPreviewHostname(hostname)) {
    throw createError({ statusCode: 404, statusMessage: "Not Found" });
  }

  // In production nginx sends every preview-origin HTTP request through this explicit route.
  // That routing happens before Nitro can mistake remote absolute assets such as /_nuxt/*.js for
  // Codex Gateway's own public files. The original URI stays in X-Browser-Preview-Path and the
  // same proxy handler used by development forwards the complete remote origin.
  await handleBrowserPreviewRequest(event.node.req, event.node.res);
});
