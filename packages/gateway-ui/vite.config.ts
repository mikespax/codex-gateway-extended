import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

const sourceRoot = resolve(import.meta.dirname, "src");
const entries: Record<string, string> = {
  utils: resolve(sourceRoot, "utils.ts"),
};

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
      // The host application must own Vue and the component dependencies. Bundling bare imports
      // here would create duplicate provide/inject runtimes when Nuxt consumes the library.
      external: (id) => !id.startsWith(".") && !id.startsWith("/") && !id.startsWith("\0"),
      output: {
        chunkFileNames: "chunks/[name]-[hash].js",
        entryFileNames: (chunk) => (chunk.name === "utils" ? "utils.js" : "[name]/index.js"),
      },
    },
  },
});
