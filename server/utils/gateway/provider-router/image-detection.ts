interface TurnStartImageInput {
  text: string;
  images?: Array<{ path?: string; url?: string; detail?: string }>;
  files?: Array<{ path: string; isImage: boolean; name?: string; size?: number }>;
  additionalContext?: Record<string, unknown>;
}

const IMAGE_EXTENSIONS = /\.(?:avif|bmp|gif|heic|jpeg|jpg|png|svg|tif|tiff|webp)(?:[?#].*)?$/i;
const IMAGE_DATA = /^data:image\//i;

/** Detect image-bearing Responses input without assuming the browser always sends an upload. */
export function requestContainsImage(value: unknown): boolean {
  return containsImage(value, new WeakSet<object>());
}

export function turnInputContainsImage(input: TurnStartImageInput): boolean {
  return (
    (input.images?.length ?? 0) > 0 ||
    (input.files?.some((file) => file.isImage || IMAGE_EXTENSIONS.test(file.path)) ?? false) ||
    requestContainsImage({
      text: input.text,
      additionalContext: input.additionalContext,
    })
  );
}

function containsImage(value: unknown, seen: WeakSet<object>): boolean {
  if (typeof value === "string") {
    const normalized = value.trim();
    return (
      IMAGE_DATA.test(normalized) ||
      IMAGE_EXTENSIONS.test(normalized) ||
      /(?:^|[?&])(?:image|image_url|input_image|mime(?:type)?)[=:]/i.test(normalized)
    );
  }
  if (value === null || typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((item) => containsImage(item, seen));
  for (const [key, child] of Object.entries(value)) {
    if (/^(?:type|kind|mimeType|mime_type)$/i.test(key) && typeof child === "string") {
      if (/image|input_image/i.test(child)) return true;
    }
    if (/^(?:url|image_url|imageUrl|path|file|file_id|fileId|data|b64_json)$/i.test(key)) {
      if (containsImage(child, seen)) return true;
    } else if (containsImage(child, seen)) {
      return true;
    }
  }
  return false;
}
