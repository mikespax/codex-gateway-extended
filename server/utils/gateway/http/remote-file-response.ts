import { isBinaryFileSync } from "isbinaryfile";
import type { H3Event } from "h3";
import { getHeader, sendStream, setResponseHeader, setResponseStatus } from "h3";
import { remoteFiles } from "../infra/host-services";
import type { HostWithSecret } from "../infra/ssh/ssh-types";

export async function sendRemoteFile(
  event: H3Event,
  host: HostWithSecret,
  path: string,
  options: { maxSize: number; contentType: string; previewKind: "document" | "detect" },
) {
  const file = await remoteFiles.openRemoteFile(host, path, {
    maxSize: options.maxSize,
  });
  const etag = remoteFileEtag(file.size, file.modifiedAt);
  setResponseHeader(event, "etag", etag);
  setResponseHeader(event, "last-modified", new Date(file.modifiedAt).toUTCString());
  setResponseHeader(event, "cache-control", "private, no-cache");
  setResponseHeader(event, "x-content-type-options", "nosniff");
  if (getHeader(event, "if-none-match") === etag) {
    file.stream.destroy();
    setResponseStatus(event, 304);
    return null;
  }
  setResponseHeader(event, "content-type", options.contentType);
  setResponseHeader(event, "content-length", file.size);
  setResponseHeader(
    event,
    "x-codex-file-preview-kind",
    options.previewKind === "document"
      ? "document"
      : isBinaryFileSync(file.sample)
        ? "binary"
        : "text",
  );
  return sendStream(event, file.stream);
}

export function remoteFileEtag(size: number, modifiedAt: number) {
  return `W/"${size.toString(16)}-${Math.trunc(modifiedAt).toString(16)}"`;
}
