import type { ThreadHistoryItem } from "~~/shared/types";
import { recordFromUnknown } from "~~/shared/utils/records";

export interface ThreadImageReference {
  id: string;
  path: string;
  url: string;
  detail: string | null;
  label: string | null;
}

/**
 * Return image references emitted by Codex for a history item.
 *
 * App-server image items have changed shape a few times (path, savedPath, and nested content are
 * all used by supported versions). Keep that compatibility at one boundary so every presenter
 * renders the same inline attachment and does not need to know protocol details.
 */
export function threadImageReferences(item: ThreadHistoryItem): ThreadImageReference[] {
  const references: ThreadImageReference[] = [];
  const seen = new Set<string>();

  const add = (input: unknown, index: number, fallbackLabel?: string | null) => {
    const record = recordFromUnknown(input);
    if (record === null) return;
    const type = typeof record.type === "string" ? record.type : "";
    const path = firstString(record.path, record.savedPath, record.filePath, record.imagePath);
    const url = firstString(record.url, record.image_url, record.imageUrl, record.source);
    const isImage =
      type === "image" ||
      type === "localImage" ||
      type === "input_image" ||
      item.type === "imageView" ||
      item.type === "imageGeneration" ||
      path !== undefined ||
      url !== undefined;
    if (!isImage) return;

    if (path === undefined && url === undefined) return;
    const key = `${path}\u0000${url}`;
    if (seen.has(key)) return;
    seen.add(key);
    references.push({
      id: `${item.id ?? item.clientId ?? item.type ?? "image"}-${index}`,
      path: path ?? "",
      url: url ?? "",
      detail: firstString(record.detail) ?? null,
      label: firstString(record.name, record.filename, fallbackLabel) ?? null,
    });
  };

  if (item.type === "imageView" || item.type === "imageGeneration") {
    add(item, 0, item.type === "imageView" ? "Image" : "Generated image");
  }

  for (const collection of [item.content, item.contentItems, item.summary, item.fragments]) {
    if (!Array.isArray(collection)) continue;
    collection.forEach((part, index) => add(part, index));
  }

  return references;
}

/**
 * Resolve a reference to a Gateway URL. Remote paths stay behind the authenticated Gateway image
 * endpoint; only explicit data/blob/HTTP URLs are passed through unchanged.
 */
export function threadImageSource(
  reference: Pick<ThreadImageReference, "path" | "url">,
  hostId: number | null,
) {
  if (reference.url !== "" && isSupportedInlineUrl(reference.url)) return reference.url;
  if (hostId === null || !reference.path.startsWith("/")) return "";
  const query = new URLSearchParams({ hostId: String(hostId), path: reference.path });
  return `/api/remote/images?${query.toString()}`;
}

function firstString(...values: unknown[]) {
  return values
    .find((value): value is string => typeof value === "string" && value.trim() !== "")
    ?.trim();
}

function isSupportedInlineUrl(value: string) {
  return /^(?:blob:|data:image\/|https?:\/\/)/i.test(value);
}
