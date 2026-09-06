import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "rolldown";

const packageRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  input: {
    index: resolve(packageRoot, "src/code-highlighter/index.ts"),
    server: resolve(packageRoot, "src/code-highlighter/server.ts"),
  },
  platform: "browser",
  output: {
    dir: resolve(packageRoot, "dist/code-highlighter"),
    format: "esm",
    cleanDir: true,
    entryFileNames: "[name].js",
    chunkFileNames: "chunks/[name]-[hash].js",
    minify: true,
  },
});
