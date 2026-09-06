import { fileURLToPath } from "node:url";
import { defineNuxtConfig } from "nuxt/config";

export default defineNuxtConfig({
  plugins: [fileURLToPath(new URL("./plugins/e2e-test-driver.client", import.meta.url))],
});
