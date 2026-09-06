#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const args = parseArgs(process.argv.slice(2));
const tokenFile = resolve(required(args, "token-file"));
const baseUrl = (args["base-url"] ?? "http://127.0.0.1:3010").replace(/\/$/, "");
const mode = args.mode ?? "history";
if (!new Set(["history", "events"]).has(mode)) fail("--mode must be history or events");
const token = (await readFile(tokenFile, "utf8")).trim();
if (token === "") fail("Supervisor token file is empty");

if (args.watch !== undefined) {
  if (mode !== "history") fail("--watch is supported only with --mode history");
  const seconds = positiveNumber(args.watch, "watch");
  let previousRevision = "";
  for (;;) {
    const payload = await requestSupervisor(baseUrl, token, mode, args);
    const revision = createHash("sha256").update(JSON.stringify(payload.history)).digest("hex");
    if (revision !== previousRevision) {
      previousRevision = revision;
      process.stdout.write(`${JSON.stringify(payload)}\n`);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, seconds * 1_000));
  }
}

const payload = await requestSupervisor(baseUrl, token, mode, args);
console.log(JSON.stringify(payload, null, 2));

async function requestSupervisor(origin, credential, requestMode, values) {
  const path =
    requestMode === "events" ? "/api/supervisor/thread/events" : "/api/supervisor/thread";
  const query = new URLSearchParams();
  if (values.limit !== undefined) query.set("limit", values.limit);
  if (requestMode === "history") {
    if (values.cursor !== undefined) query.set("cursor", values.cursor);
    if (values.direction !== undefined) query.set("sortDirection", values.direction);
  } else {
    if (values["after-id"] !== undefined) query.set("afterId", values["after-id"]);
    if (values["after-epoch"] !== undefined) query.set("afterEpoch", values["after-epoch"]);
  }
  const response = await fetch(`${origin}${path}?${query}`, {
    headers: { authorization: `Supervisor ${credential}` },
  });
  const text = await response.text();
  if (!response.ok) fail(`Supervisor API returned HTTP ${response.status}: ${text}`);
  return text === "" ? {} : JSON.parse(text);
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith("--") || value === undefined) fail("Arguments must use --name value");
    parsed[key.slice(2)] = value;
  }
  return parsed;
}

function required(values, key) {
  const value = values[key];
  if (typeof value !== "string" || value.trim() === "") fail(`--${key} is required`);
  return value;
}

function positiveNumber(value, key) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) fail(`--${key} must be a positive number`);
  return number;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
