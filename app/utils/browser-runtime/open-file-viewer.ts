type OpenFileViewerRuntime = typeof import("@codex-gateway/browser-runtime/open-file-viewer");

let runtimePromise: Promise<OpenFileViewerRuntime> | undefined;

export function loadOpenFileViewerRuntime(): Promise<OpenFileViewerRuntime> {
  runtimePromise ??= import("@codex-gateway/browser-runtime/open-file-viewer");
  return runtimePromise;
}
