import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

const sourceRoot = resolve(import.meta.dirname, "src");
const entries: Record<string, string> = {};

for (const directory of readdirSync(sourceRoot, { withFileTypes: true })) {
  const entry = resolve(sourceRoot, directory.name, "index.ts");
  if (directory.isDirectory() && existsSync(entry)) entries[directory.name] = entry;
}

export default defineConfig({
  plugins: [vue()],
  build: {
    lib: {
      entry: entries,
      formats: ["es"],
    },
    outDir: "dist",
    rolldownOptions: {
      // AI Elements is a source registry upstream, but Nuxt consumes our compiled package. Keep
      // framework and UI imports external so only imported component subpaths reach the app bundle.
      external: (id) => !id.startsWith(".") && !id.startsWith("/") && !id.startsWith("\0"),
      output: {
        chunkFileNames: "chunks/[name]-[hash].js",
        entryFileNames: "[name]/index.js",
      },
    },
  },
});
