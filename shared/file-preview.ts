const markdownExtensions = ["md", "markdown"] as const;

const dedicatedDocumentExtensions: ReadonlySet<string> = new Set([
  "avif",
  "doc",
  "docx",
  "gif",
  "jpeg",
  "jpg",
  "pdf",
  "png",
  "ppt",
  "pptx",
  "svg",
  "webp",
  "xls",
  "xlsx",
]);

export function extensionFromPath(path: string) {
  const queryIndex = path.indexOf("?");
  const pathWithoutQuery = queryIndex >= 0 ? path.slice(0, queryIndex) : path;
  const hashIndex = pathWithoutQuery.indexOf("#");
  const pathWithoutFragment =
    hashIndex >= 0 ? pathWithoutQuery.slice(0, hashIndex) : pathWithoutQuery;
  return pathWithoutFragment.split(".").pop()?.toLowerCase() ?? "";
}

export function isDedicatedDocumentPreviewPath(path: string) {
  return dedicatedDocumentExtensions.has(extensionFromPath(path));
}

export function isMarkdownPreviewPath(path: string, contentType = "") {
  const extension = extensionFromPath(path);
  return (
    markdownExtensions.some((markdownExtension) => markdownExtension === extension) ||
    contentType.includes("markdown")
  );
}
export const MAX_EDITABLE_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_GIT_DIFF_BYTES = 2 * 1024 * 1024;
