import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { recordFromUnknown } from "../../shared/utils/records";
import { routeProvider } from "../../server/utils/gateway/provider-router/matrix";
import {
  chooseProvider,
  providerStartParameters,
} from "../../server/utils/gateway/provider-router/policy";
import { classifyOpenAiFailure } from "../../server/utils/gateway/provider-router/quota";
import {
  getProviderRouterState,
  getThreadProviderRouting,
  setThreadProviderRouting,
  updateProviderRouterState,
  resetProviderRouterStateForTests,
} from "../../server/utils/gateway/provider-router/state";
import {
  logProviderDecision,
  observeProviderFailure,
} from "../../server/utils/gateway/provider-router/logging";

void test("all 288 mode, pricing, quota, credit, image and transport combinations", () => {
  let cases = 0;
  for (const mode of ["openai", "hybrid", "deepseek"] as const)
    for (const period of ["peak", "off_peak"] as const)
      for (const openaiQuota of ["available", "exhausted", "unknown"] as const)
        for (const openrouter of ["available", "exhausted", "unavailable", "unknown"] as const)
          for (const containsImages of [false, true])
            for (const useOpenRouterCreditsFirst of [false, true]) {
              const result = routeProvider({
                mode,
                period,
                openaiQuota,
                openrouter,
                containsImages,
                useOpenRouterCreditsFirst,
                requestedOpenAiModel: "gpt-5.6-luna",
                directTextModel: "deepseek-flash",
                directVisionModel: "deepseek-flash",
                openRouterTextModel: "deepseek/deepseek-v4.1-flash",
                openRouterVisionModel: "deepseek/deepseek-v4.1-flash",
              });
              const deepseek =
                mode === "deepseek" ||
                (mode === "hybrid" && (period === "off_peak" || openaiQuota === "exhausted"));
              assert.equal(result.effectiveProvider, deepseek ? "deepseek" : "openai");
              if (deepseek) {
                assert.equal(
                  result.transport,
                  useOpenRouterCreditsFirst &&
                    (openrouter === "available" || openrouter === "unknown")
                    ? "openrouter"
                    : "deepseek",
                );
                assert.ok(result.model !== null && result.model !== undefined);
                assert.ok(result.model.includes("flash"));
              } else assert.equal(result.transport, "openai");
              cases++;
            }
  assert.equal(cases, 288);
});

void test("OpenAI routing replaces a stale DeepSeek model with the configured OpenAI default", () => {
  const parameters = providerStartParameters("deepseek-v4-flash");
  assert.equal(parameters.modelProvider, "openai");
  assert.equal(parameters.model, "gpt-5.6-luna");
});

void test("per-thread routing overrides persist and take precedence over the global mode", () => {
  const path = join(mkdtempSync(join(tmpdir(), "provider-thread-route-")), "state.json");
  const previous = process.env.CODEX_PROVIDER_ROUTER_STATE_FILE;
  process.env.CODEX_PROVIDER_ROUTER_STATE_FILE = path;
  try {
    resetProviderRouterStateForTests();
    updateProviderRouterState((state) => {
      state.settings = { mode: "openai", useOpenRouterCreditsFirst: false };
    });
    setThreadProviderRouting(4, "gif-thread", {
      mode: "deepseek",
      useOpenRouterCreditsFirst: false,
    });
    assert.deepEqual(getThreadProviderRouting(4, "gif-thread"), {
      mode: "deepseek",
      useOpenRouterCreditsFirst: false,
    });
    resetProviderRouterStateForTests();
    assert.deepEqual(getThreadProviderRouting(4, "gif-thread"), {
      mode: "deepseek",
      useOpenRouterCreditsFirst: false,
    });
    const decision = chooseProvider(
      { text: "read-only status" },
      new Date("2026-09-11T12:00:00.000Z"),
      getThreadProviderRouting(4, "gif-thread"),
    );
    assert.equal(decision.transport, "deepseek");
    assert.equal(decision.model, "deepseek-flash");
    setThreadProviderRouting(4, "gif-thread", null);
    assert.equal(getThreadProviderRouting(4, "gif-thread"), null);
  } finally {
    if (previous === undefined) delete process.env.CODEX_PROVIDER_ROUTER_STATE_FILE;
    else process.env.CODEX_PROVIDER_ROUTER_STATE_FILE = previous;
    resetProviderRouterStateForTests();
  }
});

void test("exhausted credit survives process reload and clears only on explicit CLI recheck", () => {
  const directory = mkdtempSync(join(tmpdir(), "provider-state-test-"));
  const path = join(directory, "state.json");
  const previous = process.env.CODEX_PROVIDER_ROUTER_STATE_FILE;
  process.env.CODEX_PROVIDER_ROUTER_STATE_FILE = path;
  try {
    resetProviderRouterStateForTests();
    updateProviderRouterState((state) => {
      state.openrouter = "exhausted";
      state.openrouterLastError = "openrouter_credit_exhausted";
    });
    resetProviderRouterStateForTests();
    assert.equal(getProviderRouterState().openrouter, "exhausted");
    const env = { ...process.env, CODEX_PROVIDER_ROUTER_STATE_FILE: path };
    const status = execFileSync(process.execPath, ["scripts/codex-provider.mjs", "status"], {
      env,
      encoding: "utf8",
    });
    assert.match(status, /OpenRouter:\s+exhausted/);
    execFileSync(process.execPath, ["scripts/codex-provider.mjs", "recheck-openrouter"], { env });
    assert.equal(recordFromUnknown(JSON.parse(readFileSync(path, "utf8")))?.openrouter, "unknown");
  } finally {
    if (previous === undefined) delete process.env.CODEX_PROVIDER_ROUTER_STATE_FILE;
    else process.env.CODEX_PROVIDER_ROUTER_STATE_FILE = previous;
    resetProviderRouterStateForTests();
  }
});

void test("a usage rate limit must not mark subscription quota exhausted", () => {
  assert.equal(
    classifyOpenAiFailure({
      status: 429,
      code: "rate_limit_exceeded",
      message: "Usage rate limit exceeded. Retry in 1 second.",
    }).kind,
    "rate_limit",
  );
});

void test("asynchronous OpenRouter insufficient-credit event persists exhaustion", () => {
  const path = join(mkdtempSync(join(tmpdir(), "provider-credit-event-")), "state.json");
  const previous = process.env.CODEX_PROVIDER_ROUTER_STATE_FILE;
  process.env.CODEX_PROVIDER_ROUTER_STATE_FILE = path;
  try {
    resetProviderRouterStateForTests();
    logProviderDecision(
      "fixture",
      "credit-test",
      {
        mode: "deepseek",
        logicalProvider: "openai",
        effectiveProvider: "deepseek",
        transport: "openrouter",
        model: "deepseek/deepseek-v4.1-flash",
        containsImages: false,
        deepseekPeriod: "off_peak",
        reason: "deepseek_only",
      },
      { hostId: 1, status: "200" },
    );
    observeProviderFailure(1, "credit-test", "turn/completed", {
      turn: { error: { message: "Insufficient credits", code: 402 } },
    });
    assert.equal(getProviderRouterState().openrouter, "exhausted");
    resetProviderRouterStateForTests();
    assert.equal(getProviderRouterState().openrouter, "exhausted");
  } finally {
    if (previous === undefined) delete process.env.CODEX_PROVIDER_ROUTER_STATE_FILE;
    else process.env.CODEX_PROVIDER_ROUTER_STATE_FILE = previous;
    resetProviderRouterStateForTests();
  }
});

void test("DeepSeek health is unknown until a turn completes and cannot remain falsely available after failure", () => {
  const path = join(mkdtempSync(join(tmpdir(), "provider-deepseek-event-")), "state.json");
  const previous = process.env.CODEX_PROVIDER_ROUTER_STATE_FILE;
  process.env.CODEX_PROVIDER_ROUTER_STATE_FILE = path;
  try {
    resetProviderRouterStateForTests();
    logProviderDecision(
      "fixture",
      "deepseek-test",
      {
        mode: "deepseek",
        logicalProvider: "deepseek",
        effectiveProvider: "deepseek",
        transport: "deepseek",
        model: "deepseek-flash",
        containsImages: false,
        deepseekPeriod: "off_peak",
        reason: "deepseek_only_direct",
      },
      { hostId: 4, status: "200" },
    );
    assert.equal(getProviderRouterState().directDeepseek, "unknown");

    observeProviderFailure(4, "deepseek-test", "turn/completed", {
      turn: { status: "failed" },
    });
    assert.equal(getProviderRouterState().directDeepseek, "unknown");

    observeProviderFailure(4, "deepseek-test", "turn/completed", {
      turn: { status: "completed", error: null },
    });
    assert.equal(getProviderRouterState().directDeepseek, "available");

    observeProviderFailure(4, "deepseek-test", "turn/completed", {
      turn: { status: "failed", error: { message: "DeepSeek API key is missing" } },
    });
    assert.equal(getProviderRouterState().directDeepseek, "unavailable");
  } finally {
    if (previous === undefined) delete process.env.CODEX_PROVIDER_ROUTER_STATE_FILE;
    else process.env.CODEX_PROVIDER_ROUTER_STATE_FILE = previous;
    resetProviderRouterStateForTests();
  }
});
