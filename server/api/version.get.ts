export default defineEventHandler(() => ({
  // The commit identity is deliberately public and non-sensitive. It lets the deployed UI be
  // compared with the reviewed source without exposing environment files or host configuration.
  buildSha: process.env.CODEX_GATEWAY_BUILD_SHA ?? "unknown",
  nodeVersion: process.version,
}));
