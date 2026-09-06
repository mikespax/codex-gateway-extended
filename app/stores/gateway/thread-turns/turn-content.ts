import type { ComposerTurnOptions } from "~~/shared/types";
import { createUuid } from "@/lib/uuid";

export function optimisticUserContent(text: string, options: ComposerTurnOptions) {
  const imageContent = (options.images ?? []).map((image) =>
    image.url !== undefined && image.url !== ""
      ? { type: "image", url: image.url, detail: image.detail }
      : { type: "localImage", path: image.path, detail: image.detail },
  );
  return [text === "" ? null : { type: "text", text, text_elements: [] }, ...imageContent].filter(
    (content) => content !== null,
  );
}

export function createClientUserMessageId(kind: "steer" | "turn") {
  return `${kind}-${createUuid()}`;
}
