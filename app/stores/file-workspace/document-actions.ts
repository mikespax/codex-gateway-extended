import { ref, shallowRef, type Ref } from "vue";
import type { FilePreviewDocument } from "~~/shared/types";
import {
  createFileDocument,
  disposeFileDocument,
  loadFileDocument,
  saveFileDocument,
} from "./document-runtime";
import { fileDocumentKey, fileWorkspaceScopeKey, parentPath } from "./paths";
import type { FileWorkspaceScope, OpenWorkspaceFileInput } from "./types";
import { useFileGitComparisonStore } from "./git";

interface FileDocumentActionsOptions {
  scopeFor: (hostId: number, threadId: string) => FileWorkspaceScope | null;
  setScopeRoot: (input: {
    hostId: number;
    projectId: number | null;
    threadId: string;
    rootPath: string;
  }) => FileWorkspaceScope;
  workspaceOpenRequest: Ref<{ scopeKey: string; sequence: number } | null>;
}

/** Owns open-file documents and their page-session view positions. Directory state deliberately
 * lives elsewhere so tree refreshes cannot invalidate editor/document state. */
export function createFileDocumentActions(options: FileDocumentActionsOptions) {
  const documents = shallowRef<Record<string, FilePreviewDocument>>({});
  const filesByKey = shallowRef<Record<string, File | null>>({});
  const viewPositions = ref<Record<string, { left: number; top: number }>>({});
  const loadControllers = new Map<string, AbortController>();
  const gitComparisons = useFileGitComparisonStore();

  async function openFile(input: OpenWorkspaceFileInput) {
    const scope = ensureScope(input);
    if (!scope.openPaths.includes(input.path)) scope.openPaths = [...scope.openPaths, input.path];
    scope.activePath = input.path;
    options.workspaceOpenRequest.value = {
      scopeKey: fileWorkspaceScopeKey(input.hostId, input.threadId),
      sequence: (options.workspaceOpenRequest.value?.sequence ?? 0) + 1,
    };
    const document = ensureDocument(input);
    document.line = input.line ?? document.line;
    document.requestedView = input.view ?? document.requestedView;
    document.updatedAt = Date.now();
    if (document.objectUrl === "" && !document.loading) await loadDocument(document);
  }

  async function activateFile(hostId: number, threadId: string, path: string) {
    const scope = options.scopeFor(hostId, threadId);
    if (scope === null || !scope.openPaths.includes(path)) return;
    const current = activeDocumentFor(hostId, threadId);
    if (current?.dirty === true) {
      const result = await saveFileDocument(current);
      if (result.ok && result.wrote) {
        void gitComparisons.load(current, true);
      }
    }
    scope.activePath = path;
    const document = documentFor(hostId, threadId, path);
    if (document !== null && (document.stale || document.objectUrl === "") && !document.loading) {
      await loadDocument(document);
    }
  }

  function closeFile(hostId: number, threadId: string, path: string) {
    const scope = options.scopeFor(hostId, threadId);
    if (scope === null) return;
    const index = scope.openPaths.indexOf(path);
    if (index < 0) return;
    const key = fileDocumentKey(hostId, threadId, path);
    // Git comparisons are path-scoped and may still be rendered by the Changes review panel.
    // Closing one editor owns only its document; page-level resetRuntime clears shared baselines.
    loadControllers.get(key)?.abort();
    loadControllers.delete(key);
    disposeFileDocument(documents.value[key]);
    const nextDocuments = { ...documents.value };
    const nextFiles = { ...filesByKey.value };
    delete nextDocuments[key];
    delete nextFiles[key];
    documents.value = nextDocuments;
    filesByKey.value = nextFiles;
    viewPositions.value = Object.fromEntries(
      Object.entries(viewPositions.value).filter(
        ([positionKey]) => !positionKey.startsWith(`${key}:`),
      ),
    );
    scope.openPaths = scope.openPaths.filter((candidate) => candidate !== path);
    if (scope.activePath === path) {
      scope.activePath = scope.openPaths[Math.min(index, scope.openPaths.length - 1)] ?? null;
    }
  }

  function documentsForScope(hostId: number, threadId: string) {
    const scope = options.scopeFor(hostId, threadId);
    if (scope === null) return [];
    return scope.openPaths
      .map((path) => documentFor(hostId, threadId, path))
      .filter((document): document is FilePreviewDocument => document !== null);
  }

  function activeDocumentFor(hostId: number, threadId: string) {
    const path = options.scopeFor(hostId, threadId)?.activePath;
    return path === null || path === undefined ? null : documentFor(hostId, threadId, path);
  }

  function documentFor(hostId: number, threadId: string, path: string) {
    return documents.value[fileDocumentKey(hostId, threadId, path)] ?? null;
  }

  function fileForDocument(key: string) {
    return filesByKey.value[key] ?? null;
  }

  function viewPositionFor(documentKey: string, view: "source" | "markdown" | "changes") {
    return viewPositions.value[`${documentKey}:${view}`] ?? { left: 0, top: 0 };
  }

  function rememberViewPosition(
    documentKey: string,
    view: "source" | "markdown" | "changes",
    position: { left: number; top: number },
  ) {
    viewPositions.value = { ...viewPositions.value, [`${documentKey}:${view}`]: position };
  }

  function consumeDocumentViewRequest(document: FilePreviewDocument) {
    document.requestedView = null;
  }

  async function restoreScopeDocuments(hostId: number, threadId: string) {
    const scope = options.scopeFor(hostId, threadId);
    if (scope === null) return;
    for (const path of scope.openPaths) {
      ensureDocument({ hostId, projectId: scope.projectId, threadId, path });
    }
    if (scope.activePath !== null) await activateFile(hostId, threadId, scope.activePath);
  }

  async function reloadDocument(document: FilePreviewDocument) {
    document.stale = true;
    await loadDocument(document);
  }

  async function revalidateActiveFile(hostId: number, threadId: string) {
    const document = activeDocumentFor(hostId, threadId);
    if (document !== null && !document.loading) await loadDocument(document);
  }

  async function loadDocument(document: FilePreviewDocument) {
    loadControllers.get(document.key)?.abort();
    const controller = new AbortController();
    loadControllers.set(document.key, controller);
    try {
      const file = await loadFileDocument(document, controller.signal);
      // A closed document is no longer the owner of this result even if a transport ignored the
      // abort. Identity checking keeps stale requests from recreating filesByKey entries.
      if (
        !controller.signal.aborted &&
        documents.value[document.key] === document &&
        file !== undefined
      ) {
        filesByKey.value = { ...filesByKey.value, [document.key]: file };
      }
    } finally {
      if (loadControllers.get(document.key) === controller) loadControllers.delete(document.key);
    }
  }

  function ensureScope(input: OpenWorkspaceFileInput) {
    return (
      options.scopeFor(input.hostId, input.threadId) ??
      options.setScopeRoot({
        hostId: input.hostId,
        projectId: input.projectId ?? null,
        threadId: input.threadId,
        rootPath: parentPath(input.path),
      })
    );
  }

  function ensureDocument(input: OpenWorkspaceFileInput) {
    const key = fileDocumentKey(input.hostId, input.threadId, input.path);
    const existing = documents.value[key];
    if (existing !== undefined) return existing;
    const document = createFileDocument(input);
    gitComparisons.register(document);
    documents.value = { ...documents.value, [key]: document };
    return document;
  }

  function resetRuntime() {
    for (const controller of loadControllers.values()) controller.abort();
    loadControllers.clear();
    for (const document of Object.values(documents.value)) disposeFileDocument(document);
    documents.value = {};
    filesByKey.value = {};
    viewPositions.value = {};
    options.workspaceOpenRequest.value = null;
  }

  return {
    openFile,
    activateFile,
    closeFile,
    documentsForScope,
    activeDocumentFor,
    documentFor,
    fileForDocument,
    viewPositionFor,
    rememberViewPosition,
    consumeDocumentViewRequest,
    restoreScopeDocuments,
    reloadDocument,
    revalidateActiveFile,
    ensureDocument,
    resetRuntime,
  };
}
