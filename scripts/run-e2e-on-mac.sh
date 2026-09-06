#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd "$script_dir/.." && pwd)"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "run-e2e-on-mac.sh must be run on the Mac checkout (not through a remote Docker context)." >&2
  exit 2
fi

for command_name in docker git; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Missing required command: $command_name" >&2
    exit 2
  fi
done

if ! docker info >/dev/null 2>&1; then
  echo "Docker Desktop is unavailable; start it before running the E2E suite." >&2
  exit 2
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose v2 is required." >&2
  exit 2
fi

if ! git -C "$repo_dir" rev-parse --show-toplevel >/dev/null 2>&1; then
  echo "No Git checkout found at $repo_dir." >&2
  exit 2
fi

if [ ! -x "$repo_dir/tests/e2e/run-in-containers.sh" ]; then
  echo "E2E runner is missing from the checkout: $repo_dir/tests/e2e/run-in-containers.sh" >&2
  exit 2
fi

codex_home="${E2E_CODEX_HOME:-${CODEX_HOME:-$HOME/.codex}}"
if [ ! -d "$codex_home" ]; then
  echo "Codex configuration directory is missing: $codex_home" >&2
  echo "Set E2E_CODEX_HOME to a checkout-specific config directory and retry." >&2
  exit 2
fi

echo "Running containerized Gateway E2E from $repo_dir"
echo "Using disposable build cache and Mac Docker memory override: 8g / 6144 MiB V8 heap"
export E2E_BUILD_MEMORY_LIMIT="${E2E_BUILD_MEMORY_LIMIT:-8g}"
export E2E_BUILD_NODE_OPTIONS="${E2E_BUILD_NODE_OPTIONS:---max-old-space-size=6144}"
# Docker Desktop's BuildKit Bake path parallelizes the unchanged dependency/build graph while
# retaining the same Compose topology and cache mounts.
export COMPOSE_BAKE="${COMPOSE_BAKE:-true}"
exec "$repo_dir/tests/e2e/run-in-containers.sh" "$@"
