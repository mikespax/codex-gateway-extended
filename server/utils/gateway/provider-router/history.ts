/**
 * The official app-server remains the history authority, so Gateway does not replay rollout JSONL
 * when a provider changes. This narrow normalizer is used by conformance tests and is available to
 * a future HTTP transport: it removes opaque OpenAI reasoning while enforcing tool pair integrity.
 */
export function normalizePortableResponsesHistory(items: unknown[]) {
  const forwarded: unknown[] = [];
  const calls = new Set<string>();
  const outputs = new Set<string>();
  let omittedOpaqueReasoning = 0;
  for (const item of items) {
    if (item === null || item === undefined || typeof item !== "object") continue;
    const record = Object.fromEntries(Object.entries(item));
    if (
      "encrypted_content" in record ||
      (record.type === "reasoning" && "encryptedContent" in record)
    ) {
      omittedOpaqueReasoning += 1;
      continue;
    }
    const type = typeof record.type === "string" ? record.type : "";
    const callId =
      typeof record.call_id === "string"
        ? record.call_id
        : typeof record.callId === "string"
          ? record.callId
          : null;
    if (type === "function_call" || type === "custom_tool_call") {
      if (callId === null || calls.has(callId)) continue;
      calls.add(callId);
      forwarded.push(item);
      continue;
    }
    if (type === "function_call_output" || type === "custom_tool_call_output") {
      if (callId === null || outputs.has(callId) || !calls.has(callId)) continue;
      outputs.add(callId);
      forwarded.push(item);
      continue;
    }
    forwarded.push(item);
  }
  return {
    items: forwarded,
    omittedOpaqueReasoning,
    brokenToolPairs: [...calls].filter((callId) => !outputs.has(callId)).length,
  };
}

export function assertPortableToolPairs(items: unknown[]) {
  const report = normalizePortableResponsesHistory(items);
  if (report.brokenToolPairs > 0) {
    throw new Error(`Portable history contains ${report.brokenToolPairs} unmatched tool call(s)`);
  }
  return report;
}
