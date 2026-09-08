# Smart provider routing

Codex Gateway keeps the logical Codex conversation and its official app-server rollout intact
while selecting an inference provider for each new turn. A provider change is applied with
`thread/resume` on an idle thread; active turns are never replayed or interrupted.

## Modes

The Settings > Provider routing panel exposes exactly these primary modes:

- **OpenAI only** — every turn uses the existing ChatGPT/Codex authenticated provider. No
  automatic DeepSeek fallback is performed.
- **OpenAI + DeepSeek off-peak** — DeepSeek is selected outside DeepSeek's UTC weekday peak
  windows; OpenAI is selected during peak windows while its allowance is available. A confirmed
  OpenAI allowance exhaustion switches hybrid mode to DeepSeek until the allowance is rechecked or
  a trusted reset time is reached. If a remote host cannot use DeepSeek (for example, its
  app-server has no DeepSeek key), hybrid mode may fall back to OpenAI only when the OpenAI
  allowance is not exhausted. That failover is logged and never occurs in DeepSeek-only mode. Set
  `CODEX_PROVIDER_HYBRID_OPENAI_FALLBACK=false` to make such a failure fail closed instead.
- **DeepSeek only** — OpenAI is never selected. Text uses `deepseek-v4-flash`; image-bearing input
  uses `deepseek-v4-flash-vision-exp`.

DeepSeek's published weekday peak windows are 01:00–04:00 UTC and 06:00–10:00 UTC. Weekends are
off-peak. The policy is centralized in `server/utils/gateway/provider-router/pricing.ts`.

## DeepSeek transport and OpenRouter

OpenRouter is a transport, not a fourth mode. With **Use OpenRouter credits first** enabled, a
DeepSeek-selected request prefers the `openrouter` Codex model provider. The Gateway discovers and
caches current DeepSeek V4 OpenRouter slugs for six hours. If OpenRouter is unavailable, lacks a
credential, rejects the model, or reports an unusable request, the Gateway marks it unavailable
and retries safely through the direct `deepseek` provider. It does not forward an OpenAI token to
either provider.

OpenRouter account credit introspection is optional: its credits endpoint requires a management
key, so the status can remain `unknown` while routing continues. An unambiguous insufficient-credit
failure marks OpenRouter exhausted; `Recheck OpenRouter` clears that state.

Credit exhaustion is also recognized in asynchronous app-server error/completion events. Once
exhausted, OpenRouter stays disabled across Gateway restarts until an explicit `Recheck OpenRouter`
or `codex-provider recheck-openrouter`. Successful concurrent turns do not clear that latch.
Replicate is not an inference transport in this router; storing its credential does not enable
requests or spend its balance.

The mobile header and desktop toolbar display the selected thread's model and the last recorded
routing reason. This uses a bounded in-memory decision cache and existing thread metadata, with
no remote history reads. If the decision is unavailable (including after a restart), the toolbar
labels the model as a thread setting instead of inventing a routing reason.

## Configuration and commands

Settings are stored in the encrypted Gateway user config. Runtime quota/transport state is stored
atomically at `CODEX_PROVIDER_ROUTER_STATE_FILE`, `CODEX_GATEWAY_PROVIDER_ROUTER_STATE_FILE`, or
`/data/provider-router-state.json` (mode changes made by the CLI are picked up without a restart).
The state file is created with owner-only permissions and contains no credentials.

```text
codex-provider status
codex-provider openai
codex-provider hybrid
codex-provider deepseek
codex-provider openrouter on
codex-provider openrouter off
codex-provider recheck-openai
codex-provider recheck-openrouter
```

The CLI and Settings panel use the same runtime state file. The three mode labels above remain the
only primary choices.

## Existing-thread continuity

The Gateway does not rewrite rollout JSONL or fabricate/decrypt OpenAI encrypted reasoning. The
official app-server remains responsible for loading history, compaction, streaming, tool events,
and persisted provider metadata. When a provider is changed, only the native resume override is
sent. Opaque reasoning is therefore not exposed, and tool-call/output pairs remain under the
app-server's authority. The portable history helper and conformance tests reject duplicate or
unmatched function/custom-tool IDs for any future HTTP transport.

An active turn cannot be switched because replaying it could duplicate `apply_patch`, shell, or
other side effects. Wait for the turn to become idle and retry. DeepSeek-only threads start on
DeepSeek; hybrid threads are materialized first on the stock OpenAI provider (thread creation is
not inference) and switch to the current hybrid decision on their first turn. An image turn then
selects the vision model at `turn/start`.

## Status and health

Authenticated endpoints:

```text
GET   /api/provider-router/status
PATCH /api/provider-router/settings
POST  /api/provider-router/recheck-openai
POST  /api/provider-router/recheck-openrouter
GET   /api/provider-router/health
```

The responses include the mode, effective provider, transport, model, UTC pricing period, next
transition, and redacted quota/availability state. They never include keys, OAuth tokens, cookies,
prompts, or source contents. Structured request logs include request/thread IDs, provider,
transport, model, image flag, reason, status, and duration only.

## Rollback and limitations

`codex-provider openai` is the immediate safe routing rollback. To restore the pre-router Gateway
binary/configuration, redeploy the timestamped backup image and restore the Codex config backup
created under `~/.codex/backup-smart-router-YYYYMMDD-HHMMSS/`; no rollout history is deleted.

The installed app-server only accepts a provider override safely when its thread is idle and not
shared by an active monitor. OpenRouter live inference remains unavailable until a valid
`OPENROUTER_API_KEY` is supplied to the remote Codex environment; direct DeepSeek can work with
`DEEPSEEK_API_KEY`. A normal API key may not read OpenRouter account balance, which is why balance
status is advisory rather than a requirement.
