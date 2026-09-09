#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd "$script_dir/../.." && pwd)"
compose_file="$script_dir/docker-compose.yml"
project_name="${E2E_COMPOSE_PROJECT_NAME:-codex-gateway-e2e}"

if [ "${1:-}" = "--turn" ]; then
  export E2E_CODEX_TURN=1
  shift
fi

if [ "${1:-}" = "--" ]; then
  shift
fi

export E2E_UID="${E2E_UID:-12345}"
export E2E_GID="${E2E_GID:-12345}"
export E2E_CODEX_HOME="${E2E_CODEX_HOME:-$HOME/.codex}"
# The production bundle transforms more than 7,000 modules and routinely exceeds 2 GiB during
# Nitro/Rolldown linking. Keep the default local/CI budget at 4 GiB while retaining explicit
# overrides for constrained runners.
export E2E_BUILD_MEMORY_LIMIT="${E2E_BUILD_MEMORY_LIMIT:-4g}"
export E2E_BUILD_NODE_OPTIONS="${E2E_BUILD_NODE_OPTIONS:---max-old-space-size=3072}"

cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then
    docker compose -p "$project_name" -f "$compose_file" logs --no-color \
      gateway-under-test ssh-target >&2 || true
  fi
  docker compose -p "$project_name" -f "$compose_file" down --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker compose -p "$project_name" -f "$compose_file" build \
  build-runner ssh-target ssh-target-legacy-node ssh-target-legacy-codex
# Build, application server, and browser runner use separate 2 GiB cgroups. Sharing only the
# gateway network namespace preserves the production-like nip.io subdomain routing used by browser
# preview tests without coupling process memory.
docker compose -p "$project_name" -f "$compose_file" run --rm build-runner \
  bash -lc 'rm -rf .output .nuxt .data-e2e/* /e2e-output/* && pnpm exec nuxt build --extends ./tests/e2e/nuxt-layer && cp -a .output/. /e2e-output/ && node scripts/create-user.mjs "$E2E_GATEWAY_USERNAME" "$E2E_GATEWAY_PASSWORD"'
docker compose -p "$project_name" -f "$compose_file" up -d --wait \
  gateway-under-test browser-preview-ingress
docker compose -p "$project_name" -f "$compose_file" run --rm test-runner \
  bash -lc 'exec pnpm exec playwright test "$@"' \
  e2e "$@"
