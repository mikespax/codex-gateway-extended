// https://nuxt.com/docs/api/configuration/nuxt-config
import tailwindcss from "@tailwindcss/vite";

export default defineNuxtConfig({
  compatibilityDate: "2025-07-15",
  devtools: { enabled: true },
  sourcemap: {
    client: false,
    server: false,
  },
  experimental: {
    checkOutdatedBuildInterval: 5 * 60_000,
    emitRouteChunkError: "automatic-immediate",
    // Nuxt 4.5 reuses Vite's watcher instead of opening a second watcher tree.
    watcher: "builder",
  },
  routeRules: {
    // HTML shells must always revalidate so a restored mobile tab cannot keep running a retired
    // deployment. Nuxt assets are content-hashed and remain safe to cache indefinitely.
    "/**": {
      headers: {
        "cache-control": "no-store, no-cache, must-revalidate, max-age=0",
      },
    },
    "/_nuxt/**": {
      headers: {
        "cache-control": "public, max-age=31536000, immutable",
      },
    },
    // Older browser installations may still probe either conventional worker URL. Serve a valid,
    // non-cached cleanup worker instead of letting Nuxt's HTML fallback occupy that URL.
    "/sw.js": {
      headers: {
        "cache-control": "no-store, no-cache, must-revalidate, max-age=0",
        "service-worker-allowed": "/",
      },
    },
    "/service-worker.js": {
      headers: {
        "cache-control": "no-store, no-cache, must-revalidate, max-age=0",
        "service-worker-allowed": "/",
      },
    },
  },
  css: ["~/assets/css/tailwind.css"],
  modules: ["@pinia/nuxt", "@nuxtjs/device", "@nuxtjs/i18n", "nuxt-echarts"],
  echarts: {
    renderer: "canvas",
    charts: ["LineChart"],
    components: ["GridComponent", "TooltipComponent", "LegendComponent"],
  },
  vite: {
    resolve: {
      // Open File Viewer loads Prism languages in dependency order. One shared Prism instance
      // preserves that side-effect ordering without forcing all languages into a vendor chunk.
      dedupe: ["prismjs"],
    },
    plugins: [tailwindcss()],
  },
  nitro: {
    rollupConfig: {
      external: ["node:sqlite"],
    },
    experimental: {
      websocket: true,
      tasks: true,
    },
    scheduledTasks: {
      "*/30 * * * * *": ["gateway:sync-running-threads"],
      "*/5 * * * *": ["gateway:poll-tmux-monitors"],
      "0 * * * *": ["gateway:prune-expired-sessions"],
    },
  },
  i18n: {
    defaultLocale: "en",
    strategy: "no_prefix",
    detectBrowserLanguage: false,
    locales: [
      { code: "zh", name: "中文", file: "zh.json" },
      { code: "en", name: "English", file: "en.json" },
    ],
  },
});
