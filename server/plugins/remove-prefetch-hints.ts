const PREFETCH_LINK = /<link\s+rel=["']prefetch["'][^>]*>/gi;

/**
 * Nuxt's dependency manifest emits rel=prefetch hints for every lazy component. On this
 * authenticated shell that is a large burst of speculative requests; Cloudflare can
 * intentionally answer those cache-miss prefetches with 503, which obscures the real page
 * health in Chromium. Components remain lazy and are fetched when they are actually needed.
 */
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook("render:html", (html) => {
    html.head = html.head.map((chunk) => chunk.replace(PREFETCH_LINK, ""));
  });
});
