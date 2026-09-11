import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../../", import.meta.url);
registerHooks({
  resolve(specifier, context, nextResolve) {
    const resolved = specifier.startsWith("~~/")
      ? new URL(specifier.slice(3), root).href
      : specifier.startsWith(".") && context.parentURL !== undefined
        ? new URL(specifier, context.parentURL).href
        : specifier;
    if (resolved.startsWith("file:") && !existsSync(fileURLToPath(resolved))) {
      if (existsSync(fileURLToPath(`${resolved}.ts`))) {
        return nextResolve(`${resolved}.ts`, context);
      }
    }
    return nextResolve(resolved, context);
  },
});
