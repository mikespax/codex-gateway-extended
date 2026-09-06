# Codex Gateway Extended

[![Nuxt](https://img.shields.io/badge/Nuxt-4-00DC82?logo=nuxt&logoColor=white)](nuxt.config.ts)
[![Vue](https://img.shields.io/badge/Vue-3-4FC08D?logo=vuedotjs&logoColor=white)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript&logoColor=white)](package.json)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white)](package.json)
[![Playwright](https://img.shields.io/badge/Playwright-E2E-2EAD33?logo=playwright&logoColor=white)](tests/e2e)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)](docker-compose.yml)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

English | [中文](README.zh-CN.md)

**A mobile-first, multi-host command center for official Codex app-server
sessions.**

Codex Gateway Extended is designed for running serious Codex work from phones
and browsers. It adds resilient conversation routing, readable live progress,
document and archive uploads, cross-host navigation, native Android completion
replies, and scoped read-only supervision while keeping the official Codex
app-server thread as the source of truth.

> [!NOTE]
> This is a deployment-focused fork of
> [Codex Gateway](https://github.com/yunhaoli24/codex-gateway). See the
> [exhaustive fork inventory](docs/spax-fork-customizations.md) for screenshots,
> the complete 34-commit change map, security boundaries, deployment status, and
> upstream contribution strategy.

<table>
  <tr>
    <td width="50%">
      <a href="docs/assets/spax-customizations/mobile-running-turn.png"><img src="docs/assets/spax-customizations/mobile-running-turn.png" alt="Codex Gateway Extended mobile running-turn view" width="100%"></a>
    </td>
    <td width="50%">
      <a href="docs/assets/spax-customizations/mobile-model-effort-dialog.png"><img src="docs/assets/spax-customizations/mobile-model-effort-dialog.png" alt="Codex Gateway Extended mobile model and effort confirmation" width="100%"></a>
    </td>
  </tr>
</table>

Under the hood, Codex Gateway is a web frontend and connection gateway for the official Codex app-server.

It is not a reimplementation of Codex, and it does not run an agent runtime in the browser. The browser talks only to Codex Gateway. Gateway connects to your remote machines over SSH, manages the official `codex app-server` lifecycle, and renders official app-server threads, events, approvals, file changes, images, diffs, terminal output, and sub-agent activity in a web UI.

The goal is simple: open Codex sessions from many servers in a browser while keeping Codex app-server as the source of truth. If Codex Desktop, another client, and Codex Gateway connect to the same app-server thread, they should observe the same state stream.

<p align="center">
  <img src="docs/images/codex-gateway-workspace.png" alt="Codex Gateway showing remote hosts, projects, a Codex agent loop, and workspace tabs" width="100%">
</p>

<p align="center"><sub>A browser workspace for Codex sessions running across remote SSH hosts.</sub></p>

## Why

- Use Codex from any browser without exposing SSH credentials to the browser.
- Manage multiple SSH hosts, projects, and Codex threads from one workspace.
- Keep official Codex app-server semantics instead of inventing a parallel protocol.
- Share one gateway-side SSH/RPC lifecycle per host across browser tabs.
- Recover thread state after browser reloads, app-server restarts, or temporary SSH disconnects.
- Open a direct SSH terminal next to the agent loop when you need to inspect or fix the remote environment manually.
- Preview remote web applications in an isolated Browser panel without publishing their ports.
- Monitor long-running training or inference jobs in tmux across all hosts and get notified when a pane exits or returns to its shell.
- Watch CPU, memory, network, disk, and GPU activity without leaving the conversation workspace.

## Feature Tour

These views are captured from the real Playwright E2E environment. Select any image to open it at full resolution.

### Codex workflows

<table>
  <tr>
    <td width="50%">
      <a href="docs/images/features/en/goal-progress.png"><img src="docs/images/features/en/goal-progress.png" alt="Goal details with objective, elapsed time, token usage, and controls" width="100%"></a><br>
      <strong>Goal lifecycle</strong><br>
      <sub>Track app-server goal progress, edit the objective, pause or resume execution, and clear completed work.</sub>
    </td>
    <td width="50%">
      <a href="docs/images/features/en/plan-mode.png"><img src="docs/images/features/en/plan-mode.png" alt="Plan mode with a structured implementation plan and actions" width="100%"></a><br>
      <strong>Plan mode</strong><br>
      <sub>Review a structured plan, continue planning, or move directly into implementation.</sub>
    </td>
  </tr>
</table>

### Remote workspace

<table>
  <tr>
    <td width="50%">
      <a href="docs/images/features/en/file-workspace.png"><img src="docs/images/features/en/file-workspace.png" alt="Dockable file workspace with a remote tree and rendered Markdown preview" width="100%"></a><br>
      <strong>Files, editing, and previews</strong><br>
      <sub>Browse remote trees, edit text, and preview Markdown, LaTeX, images, PDF, and Office documents beside the agent.</sub>
    </td>
    <td width="50%">
      <a href="docs/images/features/en/browser-preview.png"><img src="docs/images/features/en/browser-preview.png" alt="Remote browser preview with HTTP, WebSocket, and resource diagnostics" width="100%"></a><br>
      <strong>Remote browser preview</strong><br>
      <sub>Open a Host's private web service through SSH with full-origin HTTP/WebSocket forwarding and visible resource errors.</sub>
    </td>
  </tr>
</table>

### Operations and notifications

<table>
  <tr>
    <td width="50%">
      <a href="docs/images/features/en/host-monitoring.png"><img src="docs/images/features/en/host-monitoring.png" alt="Live CPU, memory, network, and disk monitoring charts" width="100%"></a><br>
      <strong>Live host metrics</strong><br>
      <sub>Stream CPU, memory, network, and disk telemetry over the shared Gateway realtime connection.</sub>
    </td>
    <td width="50%">
      <a href="docs/images/features/en/gpu-process-monitoring.png"><img src="docs/images/features/en/gpu-process-monitoring.png" alt="GPU metrics and process ownership table" width="100%"></a><br>
      <strong>GPU process attribution</strong><br>
      <sub>Inspect utilization, temperature, VRAM, users, PIDs, runtimes, and commands for remote training jobs.</sub>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <a href="docs/images/features/en/tmux-monitoring.png"><img src="docs/images/features/en/tmux-monitoring.png" alt="Cross-host tmux monitor with sessions, panes, and active jobs" width="100%"></a><br>
      <strong>Cross-host tmux monitoring</strong><br>
      <sub>Discover panes, inspect recent output, and monitor one run or every future run from one user-wide view.</sub>
    </td>
    <td width="50%">
      <a href="docs/images/features/en/notifications.png"><img src="docs/images/features/en/notifications.png" alt="Actionable conversation completion notification" width="100%"></a><br>
      <strong>Browser and Bark notifications</strong><br>
      <sub>Receive de-duplicated completion alerts and open the matching conversation or tmux pane directly.</sub>
    </td>
  </tr>
</table>

## Architecture

```text
Browser
  └─ HTTP + WebSocket
     └─ Codex Gateway (Nuxt server)
        ├─ SQLite encrypted config
        ├─ SSH connection pool
        ├─ one shared RPC client per host
        ├─ direct SSH PTY terminal sessions
        ├─ HTTP/WebSocket preview proxy over SSH
        ├─ SQLite-backed tmux monitor scheduler
        ├─ thread/event cache
        └─ remote official codex app-server
```

Core rules:

- Browsers never connect directly to remote app-servers or SSH hosts.
- Gateway owns SSH, remote Codex upgrade, app-server startup, RPC, and event fan-out.
- Turn start, steer, interrupt, terminal input, terminal resize, and server-request responses use the page WebSocket.
- Gateway caches recent thread state, warms pinned threads, and periodically refreshes stale running threads from app-server state.
- The frontend renders domain state from Gateway and does not maintain a second durable timeline.

## Features

- **Server-side accounts and config**: manually created users, Bearer token login, encrypted host/project/thread config in SQLite.
- **Remote hosts**: SSH password, private key, ssh-agent, and optional SSH proxy support.
- **Codex runtime management**: detects remote Codex versions, upgrades old installs, restarts stale app-server processes, and reconnects automatically.
- **Thread discovery and restore**: discovers Codex sessions from remote state and opens threads with a small cached turn window first.
- **Realtime turns**: start new turns, steer running turns, interrupt active turns, and answer app-server dynamic requests over WebSocket.
- **Plan and goal modes**: review and execute structured plans; set, edit, pause, resume, stop, or clear app-server goals with token/time progress in the composer and details dialog.
- **Agent loop UI**: reasoning, command execution, terminal waits, file edits, streaming diffs, images, context compaction, sleep, MCP/tool calls, notifications, and sub-agent side panels.
- **Dockable IDE workspace**: split, resize, float, or pop out Agent, Files, Terminal, Browser, and Sub-agent panels with per-thread layouts persisted locally.
- **Remote file workspace**: browse the current project's file tree, edit text files, and preview Markdown, code, images, PDF, and Office files without downloading them first.
- **Remote terminal tabs**: open independent SSH PTY terminals beside the agent loop with `@xterm/xterm`; terminal sessions are isolated per user and host.
- **Remote browser tabs**: preview a Host's `localhost` HTTP/HTTPS application in Dockview through SSH, including full-origin resources and WebSocket traffic, without exposing an additional Gateway port. Per-resource failures are reported inside the preview.
- **Host and GPU observability**: stream CPU, memory, network, disk, GPU utilization, temperature, and VRAM metrics over the shared realtime connection. GPU process tables identify the remote user, PID, runtime, memory, and command behind each workload.
- **User-wide tmux monitoring**: scan tmux sessions across every configured Host, inspect recent pane output, and bind a monitor to the relevant Codex thread. One-shot monitors notify when the current job exits or returns to its shell; permanent monitors wait for later runs and notify after each completed run. Active monitors and history are persisted in SQLite.
- **Multi-client sync**: multiple browser tabs can subscribe to the same thread and receive the same gateway-side app-server event stream.
- **State repair**: after SSH/app-server reconnect, Gateway refreshes running thread state; a Nitro scheduled task also checks stale running threads.
- **Actionable notifications**: in-browser Sonner notifications and optional server-side Bark push for completed main turns and tmux jobs. Thread notifications navigate to the conversation; tmux notifications open the matching monitor and pane output. Delivery is de-duplicated per user and completion.
- **Mobile layout**: responsive sidebar, composer, long-press context actions, and sub-agent panels.
- **Real E2E coverage**: Playwright tests run against a real Nuxt server, real SSH Docker target, and real Codex app-server.

## Project Structure

```text
.
├── app/                       # Nuxt frontend, Pinia store, chat/thread/settings UI
├── packages/gateway-ui/       # Precompiled shadcn-vue component package
├── packages/gateway-ai-elements/ # Precompiled AI Elements component package
├── packages/gateway-browser-runtime/ # Precompiled browser runtime and rendering helpers
├── server/api/                # Browser-facing HTTP and WebSocket API
├── server/tasks/              # Nitro scheduled task entrypoints
├── server/utils/gateway/      # SSH, Codex RPC, runtime broker, storage, notifications
├── shared/                    # Shared DTOs, config, protocol helpers, thread history
├── i18n/locales/              # Chinese and English UI messages
├── tests/e2e/                 # Real SSH + app-server Playwright E2E
├── third_party/openai-codex/  # Official Codex source submodule for protocol reference
├── Dockerfile
└── docker-compose.yml
```

## Quick Start

Prerequisites: Docker with Compose, Git, and network access from Gateway to the SSH hosts you want to manage.

```bash
git clone --recurse-submodules --branch spax/customizations-20260824 \
  https://github.com/mikespax/codex-gateway-extended.git
cd codex-gateway-extended

cp .env.example .env
# Replace CODEX_GATEWAY_CONFIG_SECRET in .env with: openssl rand -hex 32

docker network create web-common 2>/dev/null || true
docker compose build
docker compose run --rm codex-gateway \
  node scripts/create-user.mjs admin '<a-password-with-at-least-8-characters>'
docker compose up -d
```

Open the service through your reverse proxy, sign in with the manually created account, and add the first SSH host from Settings. The bundled Compose file intentionally exposes port `3000` only to the external `web-common` Docker network.

## Local Development

```bash
pnpm install
pnpm dev
```

Common commands:

```bash
pnpm lint
pnpm build
pnpm test:e2e
```

### Mac E2E runner

The containerized E2E suite can run from a local Mac checkout, keeping its real Docker SSH
targets, Gateway server, preview ingress, and Playwright topology intact. This is opt-in; it does
not use a remote Docker socket or modify the VPS. After pushing the branch to the fork, clone it
on the Mac and run:

```bash
git clone --recurse-submodules --branch spax/customizations-20260824 \
  https://github.com/mikespax/codex-gateway-extended.git \
  ~/src/codex-gateway-extended
cd ~/src/codex-gateway-extended
scripts/run-e2e-on-mac.sh
```

The wrapper checks for a real Mac checkout, Docker Desktop, Compose v2, and a readable Codex
configuration directory before starting. It defaults the E2E build container to `8g` and V8 old
space to `6144` MiB; override `E2E_BUILD_MEMORY_LIMIT` and `E2E_BUILD_NODE_OPTIONS` when needed.
Docker Desktop's configured VM memory is the effective limit, not the Mac's physical RAM. The
Mac runner should therefore have at least 12 GiB assigned to Docker Desktop for the default
override. It also enables Docker Compose Bake by default for parallel cache-aware builds; set
`COMPOSE_BAKE=false` if Docker Desktop is configured without Bake. BuildKit persists only
disposable pnpm and Vite/Nuxt transform caches; `.nuxt`, `.output`, test data, and Codex
configuration remain run-specific.

Environment variables:

| Variable                      | Required          | Description                                                                                             |
| ----------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------- |
| `CODEX_GATEWAY_CONFIG_SECRET` | Yes in production | Stable secret used to encrypt stored host/project/thread config.                                        |
| `CODEX_GATEWAY_DB_PATH`       | No                | SQLite database path. Defaults to the app data path; Docker uses `/data/codex-gateway.db`.              |
| `HOST`                        | No                | Nuxt listen host. Docker uses `0.0.0.0`.                                                                |
| `PORT`                        | No                | Nuxt listen port. Docker uses `3000`.                                                                   |
| `BROWSER_PREVIEW_DOMAIN`      | Browser preview   | Parent domain for isolated preview origins; configure wildcard DNS for `p-*.your-domain`.               |
| `BROWSER_PREVIEW_SECRET`      | No                | HMAC secret for stable per-user/Host/target preview origins. Defaults to `CODEX_GATEWAY_CONFIG_SECRET`. |
| `BROWSER_PREVIEW_SCHEME`      | No                | Public preview scheme, `https` by default. Use `http` only for local E2E/development.                   |
| `BROWSER_PREVIEW_PUBLIC_PORT` | No                | Optional public port included in preview origins for local development.                                 |

Create an admin user:

```bash
CODEX_GATEWAY_CONFIG_SECRET="replace-with-a-long-random-secret" \
CODEX_GATEWAY_DB_PATH="./data/codex-gateway.db" \
pnpm user:create <username> <password>
```

`CODEX_GATEWAY_CONFIG_SECRET` encrypts stored connection config. Use a stable, sufficiently long secret in production. Changing it makes existing encrypted config unreadable.

## Security Model

- SSH credentials and Codex tokens stay on the server side.
- Browser clients authenticate to Gateway with a Bearer token.
- Stored connection config is encrypted in SQLite with `CODEX_GATEWAY_CONFIG_SECRET`.
- Direct terminal tabs, tmux inspection, and remote Browser proxy connections are server-side SSH channels; they do not expose SSH keys or remote ports to the browser.
- Public deployments should run behind a trusted reverse proxy with HTTPS.

## Docker Deployment

```bash
export CODEX_GATEWAY_CONFIG_SECRET="replace-with-a-long-random-secret"
docker compose up -d --build
```

The compose service exposes container port `3000` only to Docker networks. Put it behind nginx, Caddy, Cloudflare Tunnel, or another trusted reverse proxy. SQLite data is stored at `/data/codex-gateway.db` and persisted through `./data:/data`.

Remote Browser panels use isolated origins such as `p-<hmac>.example.com`. Configure wildcard DNS for `p-*.example.com` and route those hosts to the same Codex Gateway Nitro port (`3000`). The reverse proxy must preserve the Host header and WebSocket upgrades. No second listener or published container port is required. Upstream `Content-Security-Policy` and `X-Frame-Options` are preserved, so applications that prohibit embedding remain blocked by the browser.

## Testing

E2E tests do not mock Codex app-server:

- A production Nuxt build is started in the test runner.
- Docker provides a real SSH target.
- Gateway connects to the target over SSH and starts or resumes a real Codex app-server.
- Playwright verifies login, config, thread restore, realtime sync, mobile layout, diff rendering, dynamic requests, notifications, sub-agent UI, remote files, browser preview, and real tmux monitoring.

Run:

```bash
pnpm test:e2e
```

If the host machine does not have `pnpm`, use the containerized runner directly:

```bash
tests/e2e/run-in-containers.sh
```

Run the full E2E suite for changes involving SSH, RPC, WebSocket, thread state, config, upload, diff rendering, mobile layout, or app-server protocol handling.

## Relationship With Codex

Codex Gateway targets the official Codex app-server protocol. `third_party/openai-codex/` is a submodule used only as a protocol and behavior reference. Gateway should align with official app-server behavior instead of fabricating frontend-only events or maintaining compatibility branches for old protocols.

## Contributing

Issues and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before changing SSH, RPC, realtime state, or app-server protocol behavior. Please report vulnerabilities privately according to [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
