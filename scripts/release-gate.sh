#!/usr/bin/env bash
set -euo pipefail

usage() {
  printf 'Usage: %s [--build]\n' "$0"
  printf '  Verify a clean non-main release checkout; --build also tags the image by commit SHA.\n'
}

build_image=0
if [[ "${1:-}" == "--build" ]]; then
  build_image=1
elif [[ "${1:-}" != "" ]]; then
  usage >&2
  exit 2
fi

branch="$(git branch --show-current)"
if [[ "$branch" == "main" || "$branch" == "master" || "$branch" == "" ]]; then
  printf 'Release gate refuses branch %q; use a reviewed feature/release branch.\n' "$branch" >&2
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  printf 'Release gate refuses a dirty worktree. Commit or deliberately preserve every change first.\n' >&2
  git status --short >&2
  exit 1
fi

commit="$(git rev-parse HEAD)"
printf 'Release candidate: %s (%s)\n' "$commit" "$branch"
printf 'Working tree: clean\n'

if [[ "$build_image" == 1 ]]; then
  docker compose build --build-arg "BUILD_SHA=$commit" codex-gateway
  mapfile -t image_refs < <(docker compose config --images | sed '/^$/d')
  if [[ "${#image_refs[@]}" -ne 1 ]]; then
    printf 'Expected exactly one configured Gateway image, found %s.\n' "${#image_refs[@]}" >&2
    exit 1
  fi
  image_id="$(docker image inspect "${image_refs[0]}" --format '{{.Id}}' 2>/dev/null || true)"
  if [[ -z "$image_id" ]]; then
    printf 'Unable to identify the built Gateway image.\n' >&2
    exit 1
  fi
  docker image tag "$image_id" "codex-gateway:$commit"
  printf 'Tagged image: codex-gateway:%s\n' "$commit"
fi
