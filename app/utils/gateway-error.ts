import { FetchError } from "ofetch";
import { recordFromUnknown } from "~~/shared/utils/records";
import { firstNonEmptyString } from "~~/shared/utils/strings";

export interface GatewayErrorPayload {
  code?: string;
  details?: Record<string, unknown>;
  message?: string;
  statusCode?: number;
  statusMessage?: string;
}

export function gatewayErrorPayload(error: unknown): GatewayErrorPayload {
  // ofetch exposes response payloads through FetchError.data getters. Converting the Error to a
  // plain record first drops those non-enumerable accessors, so inspect the typed transport error
  // before falling back to generic SSH, RPC, and browser errors.
  const fetchData = error instanceof FetchError ? recordFromUnknown(error.data) : null;
  const root = recordFromUnknown(error);
  const response = recordFromUnknown(root?.response);
  const candidates = [
    fetchData,
    recordFromUnknown(response?._data),
    recordFromUnknown(root?.data),
    root,
  ];
  const payload = candidates.find(
    (candidate) =>
      candidate !== null &&
      (typeof candidate.message === "string" ||
        typeof candidate.statusMessage === "string" ||
        typeof candidate.code === "string" ||
        recordFromUnknown(candidate.details) !== null),
  );
  return payload ?? {};
}

export function gatewayErrorMessage(error: unknown, fallback: string) {
  const payload = gatewayErrorPayload(error);
  const root = recordFromUnknown(error);
  return (
    firstNonEmptyString([
      payload.message,
      payload.statusMessage,
      typeof root?.message === "string" ? root.message : null,
    ]) ?? fallback
  );
}
