#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const args = parseArgs(process.argv.slice(2));
const tokenFile = resolve(required(args, "token-file"));
const baseUrl = (args["base-url"] ?? "http://127.0.0.1:3010").replace(/\/$/, "");
const clientMessageId = args["client-message-id"] ?? randomUUID();
const useStdin = args.stdin === "true";
const messageFile = args["message-file"];
if (useStdin === (messageFile !== undefined)) {
  fail("Provide exactly one of --stdin true or --message-file <path>");
}

const token = (await readFile(tokenFile, "utf8")).trim();
if (token === "") fail("Supervisor token file is empty");
const text = (
  useStdin ? await readFile("/dev/stdin", "utf8") : await readFile(resolve(messageFile), "utf8")
).trim();
if (text === "") fail("Supervisor message is empty");

const response = await fetch(`${baseUrl}/api/supervisor/thread/message`, {
  method: "POST",
  headers: {
    authorization: `Supervisor ${token}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({ text, clientMessageId }),
});
const responseText = await response.text();
if (!response.ok) fail(`Supervisor API returned HTTP ${response.status}: ${responseText}`);
const payload = responseText === "" ? {} : JSON.parse(responseText);
console.log(JSON.stringify({ clientMessageId, ...payload }, null, 2));

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

function fail(message) {
  console.error(message);
  process.exit(1);
}
