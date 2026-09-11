#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const statePath =
  process.env.CODEX_PROVIDER_ROUTER_STATE_FILE ||
  process.env.CODEX_GATEWAY_PROVIDER_ROUTER_STATE_FILE ||
  join(homedir(), ".codex-gateway", "data", "provider-router-state.json");
const defaults = {
  settings: { mode: "hybrid", useOpenRouterCreditsFirst: true },
  openaiQuota: "available",
  directDeepseek: "unknown",
  openrouter: "unknown",
  openrouterModels: { text: null, vision: null, fetchedAt: null },
};

const args = process.argv.slice(2);
const command = args.shift() || "status";
const state = readState();

if (command === "status") {
  printStatus(state);
} else if (command === "openai" || command === "openai-only") {
  setMode(state, "openai");
} else if (command === "hybrid" || command === "offpeak") {
  setMode(state, "hybrid");
} else if (command === "deepseek" || command === "deepseek-only") {
  setMode(state, "deepseek");
} else if (command === "openrouter") {
  const value = args.shift();
  if (value !== "on" && value !== "off") usage("openrouter expects on or off");
  state.settings.useOpenRouterCreditsFirst = value === "on";
  writeState(state);
  console.log(`OpenRouter credits first: ${value.toUpperCase()}`);
} else if (command === "recheck-openai") {
  state.openaiQuota = "available";
  state.openaiQuotaDetectedAt = null;
  state.openaiQuotaResetAt = null;
  state.openaiQuotaReason = null;
  writeState(state);
  console.log("OpenAI quota state cleared; the next eligible request may try OpenAI.");
} else if (command === "recheck-openrouter") {
  state.openrouter = "unknown";
  state.openrouterLastError = null;
  state.openrouterModels.fetchedAt = null;
  writeState(state);
  console.log("OpenRouter state cleared; model discovery will run on the next status/request.");
} else {
  usage(`unknown command: ${command}`);
}

function readState() {
  if (!existsSync(statePath)) return structuredClone(defaults);
  try {
    const parsed = JSON.parse(readFileSync(statePath, "utf8"));
    return {
      ...structuredClone(defaults),
      ...parsed,
      settings: { ...defaults.settings, ...(parsed.settings || {}) },
      openrouterModels: { ...defaults.openrouterModels, ...(parsed.openrouterModels || {}) },
    };
  } catch {
    return structuredClone(defaults);
  }
}

function setMode(state, mode) {
  state.settings.mode = mode;
  writeState(state);
  console.log(`Provider mode: ${label(mode)}`);
}

function printStatus(state) {
  const now = new Date();
  const period = pricingPeriod(now);
  const route = chooseRoute(state, period);
  const next = nextPricingTransition(now);
  console.log("Codex Gateway");
  console.log(`Mode:                ${label(state.settings.mode)}`);
  console.log("Logical provider:    OpenAI");
  console.log(`Effective provider:  ${route.provider === "openai" ? "OpenAI" : "DeepSeek"}`);
  console.log(`Transport:           ${route.transport}`);
  console.log(`Model:               ${route.model || "not applicable"}`);
  console.log(`DeepSeek period:     ${period === "peak" ? "PEAK" : "OFF-PEAK"}`);
  console.log(`Next change:         ${next.toISOString()}`);
  console.log(`Use OpenRouter first: ${state.settings.useOpenRouterCreditsFirst ? "on" : "off"}`);
  console.log(`OpenAI quota:         ${state.openaiQuota || "unknown"}`);
  console.log(`Direct DeepSeek:      ${availabilityLabel(state.directDeepseek)}`);
  console.log(`OpenRouter:           ${state.openrouter || "unknown"}`);
  console.log(`State file:           ${statePath}`);
}

function availabilityLabel(value) {
  if (value === "available") return "available (verified)";
  if (value === "unavailable") return "unavailable (verified)";
  return "unknown (not verified)";
}

function chooseRoute(state, period) {
  const useDeepSeek =
    state.settings.mode === "deepseek" ||
    (state.settings.mode === "hybrid" &&
      (period === "off_peak" || state.openaiQuota === "exhausted"));
  if (!useDeepSeek) return { provider: "openai", transport: "openai", model: null };
  const useOpenRouter =
    state.settings.useOpenRouterCreditsFirst &&
    state.openrouter !== "exhausted" &&
    state.openrouter !== "unavailable";
  return useOpenRouter
    ? {
        provider: "deepseek",
        transport: "openrouter",
        model: state.openrouterModels?.text?.includes("deepseek-v4.1-flash")
          ? state.openrouterModels.text
          : "deepseek/deepseek-v4.1-flash",
      }
    : {
        provider: "deepseek",
        transport: "deepseek",
        model: "deepseek-flash",
      };
}

function pricingPeriod(now) {
  const day = now.getUTCDay();
  if (day === 0 || day === 6) return "off_peak";
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  return (minutes >= 60 && minutes < 240) || (minutes >= 360 && minutes < 600)
    ? "peak"
    : "off_peak";
}

function nextPricingTransition(now) {
  for (let dayOffset = 0; dayOffset <= 8; dayOffset += 1) {
    const day = new Date(now.getTime());
    day.setUTCDate(day.getUTCDate() + dayOffset);
    day.setUTCHours(0, 0, 0, 0);
    const weekday = day.getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    for (const minute of [60, 240, 360, 600]) {
      const candidate = new Date(day.getTime() + minute * 60_000);
      if (candidate.getTime() > now.getTime()) return candidate;
    }
  }
  return new Date(now.getTime() + 24 * 60 * 60_000);
}

function label(mode) {
  return mode === "openai"
    ? "OpenAI only"
    : mode === "deepseek"
      ? "DeepSeek only"
      : "OpenAI + DeepSeek off-peak";
}

function writeState(value) {
  const parent = dirname(statePath);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const temporary = `${statePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, statePath);
}

function usage(message) {
  console.error(message);
  console.error(
    "Usage: codex-provider status|openai|hybrid|deepseek|openrouter on|off|recheck-openai|recheck-openrouter",
  );
  process.exitCode = 2;
}
