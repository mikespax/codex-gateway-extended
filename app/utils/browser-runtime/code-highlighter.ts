type CodeHighlighterRuntime = typeof import("@codex-gateway/browser-runtime/code-highlighter");

let runtimePromise: Promise<CodeHighlighterRuntime> | undefined;

export function loadCodeHighlighterRuntime(): Promise<CodeHighlighterRuntime> {
  runtimePromise ??= import("@codex-gateway/browser-runtime/code-highlighter");
  return runtimePromise;
}
