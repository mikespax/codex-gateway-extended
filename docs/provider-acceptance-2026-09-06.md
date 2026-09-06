# Provider acceptance results — 2026-09-06

Result: **NOT ACCEPTED for automatic mixed-provider production use.**

The public Gateway remained online and its existing **OpenAI only** selection was preserved.
No customer repositories were edited and no existing production conversation was switched during
these tests. Native Codex live tests used an isolated CODEX_HOME and temporary Git repository.
The disposable threads were archived afterward. Keys were never included in test output.

## Passing checks

- Nine automated tests, including an exhaustive 288-case routing matrix (mode, pricing period,
  quota, credit state, images, OpenRouter preference).
- UTC pricing boundaries, image detection, tool-pair checks, and quota classification.
- OpenRouter credit exhaustion survives state reload and a separate CLI process. Explicit
  `recheck-openrouter` clears the latch. Asynchronous insufficient-credit completion is detected.
- Direct DeepSeek Flash completed native Codex shell inspection, file patch, Node assertion, and
  cleanup. Native file-change and command-execution events were observed.
- OpenRouter Flash completed shell-based file creation, assertion, and cleanup. Native custom
  apply_patch equivalence was **not** established by that run: it emitted command-execution rather
  than file-change events.
- Both Flash Vision endpoints correctly identified a red square on the left and blue circle on
  the right, then executed a Node command returning 5. Streaming text/reasoning/item/turn lifecycle
  events were observed through the real Codex app-server.
- Direct DeepSeek returned from Vision to text Flash and recalled the preceding image correctly.
- **Official compaction recovery passed:** after the direct round trip failed, native
  `thread/compact/start` on DeepSeek, followed by an idle archive/unarchive reload, let OpenAI
  successfully recall the marker in the same thread `01a077d6-8040-77c1-aa9e-c0753a40e2ed`.
  This preserves stored history but summarizes the effective context. Gateway does not automate it.
- Narrow-desktop drawer, narrow-desktop Enter-to-send, and protected HTTP authentication E2E tests
  passed.

## Blocking failures

1. **Loaded-thread resume does not change providers.** The app-server returned its existing active
   provider despite a different `modelProvider` request. A targeted archive/unarchive reload of an
   idle disposable thread allowed the same ID to resume with the requested provider. Gateway does
   not automatically perform that recovery. Unsubscribe alone is not immediate unloading.
2. **Returning to OpenAI rejects mixed-provider history.** Both direct-only and OpenRouter-inclusive
   sequences retained the marker `ROUTER-CONTINUITY-MAPLE-42` on DeepSeek, but the return OpenAI turn
   failed HTTP 400 with `input[9].content ... array_above_max_length`. No rollout files were rewritten
   to bypass the failure. The portable-history normalizer is not wired into native inference and
   must not be cited as evidence that this interoperability works.
3. **OpenRouter text-after-image fails.** Switching from Flash Vision to text Flash while the image
   remains in history failed HTTP 404: `No endpoints found that support image input`. Selection based
   only on the newest user input is insufficient. The vision route must account for retained images.
   A further tool-output test also failed: text Flash calling `view_image` received
   `[Unsupported Image]` through direct DeepSeek, and OpenRouter failed HTTP 404 after the image
   tool result. A completed direct turn did not mean successful image understanding. Mid-turn
   image routing is not implemented by a turn-boundary-only provider selector.
4. **New-thread Gateway routing remains unaccepted.** The preceding full E2E attempt reached
   `no rollout found for thread id` during its new-thread send. Native thread/start tests are not a
   replacement for passing that Gateway path.
5. **Full transparent quota failover is unverified.** Persistent credit state and policy decisions
   passed, but safe same-request asynchronous OpenAI-quota replay and complete credential-isolation
   network interception tests have not been established. Do not equate turn/start acceptance with
   successful inference or safe replay.

Same-ID evidence:

| Test | Thread ID before and after | Outcome |
| --- | --- | --- |
| OpenAI → DeepSeek → OpenRouter → OpenAI | `01a077d4-f8f8-76d2-b5f1-d4195aea255d` | Context recalled on both DeepSeek transports; return OpenAI failed |
| OpenAI → direct DeepSeek → OpenAI | `01a077d6-8040-77c1-aa9e-c0753a40e2ed` | Context recalled on DeepSeek; return OpenAI failed |

The second test subsequently passed its OpenAI return after official DeepSeek compaction and an
idle reload, without changing the thread ID. This is an empirically verified recovery mechanism,
not evidence of automatic Gateway round-trip compatibility.

## UI test result

Containerized Playwright run: **3 passed, 2 failed, 3 not run** (configured stop after two failures).
The failures expected Chinese Settings/Appearance labels while the rendered UI was English.
Screenshots and error-context artifacts were inspected under `test-results/`. Trace recording is
disabled in the existing Playwright config. This is not a pass of the full 119-test suite.

`pnpm lint` completed: typecheck passed, but the lint phase failed on existing repository-wide
issues including `scripts/create-supervisor-grant.mjs`. Targeted lint of this testing pass's new
loader/tests and quota fix passed, as did `git diff --check`.

## Changes from this testing pass

- Added repeatable routing-matrix and persistent-state regression tests, a Node TypeScript import
  loader, and unit-test TypeScript configuration.
- Fixed a demonstrated classifier bug in source: `rate_limit_exceeded` with message
  `Usage rate limit exceeded` was incorrectly classified as exhausted allowance. The new regression
  passes. This source fix has **not** been deployed in this testing pass.
- The live Gateway image/configuration and user provider selection were not replaced.

Reproduce automated provider tests with Node 24:

```sh
node --import ./tests/unit/provider-router-loader.ts --test tests/unit/provider-router.test.ts tests/unit/provider-router-runtime.test.ts
```

Do not enable automatic hybrid switching on valuable conversations based on these results. A
provider-neutral inference/history compatibility layer, or an empirically validated safe native
mechanism, is still required before the original production acceptance criteria can be met.
