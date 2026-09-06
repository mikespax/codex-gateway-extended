import { computed, ref, unref, type MaybeRef } from "vue";

import { useGatewayBootstrapStore } from "@/stores/gateway-bootstrap";
import { useGatewayThreadTurnsStore } from "@/stores/gateway-thread-turns";
import { captureSessionEpoch } from "@/utils/session-epoch";

type RequestId = string | number;

interface ServerRequestResponderSource {
  hostId: MaybeRef<number | null | undefined>;
  threadId: MaybeRef<string | null | undefined>;
  requestId: MaybeRef<RequestId | null | undefined>;
}

export function useServerRequestResponder(source: ServerRequestResponderSource) {
  const store = useGatewayBootstrapStore();
  const threadTurns = useGatewayThreadTurnsStore();
  const { t } = useI18n();
  const responding = ref(false);
  const context = computed(() => ({
    hostId: unref(source.hostId) ?? null,
    threadId: unref(source.threadId) ?? null,
  }));
  const canRespond = computed(() => {
    const hostId = unref(source.hostId);
    const threadId = unref(source.threadId);
    const requestId = unref(source.requestId);
    return (
      hostId !== null &&
      hostId !== undefined &&
      threadId !== null &&
      threadId !== undefined &&
      threadId !== "" &&
      requestId !== null &&
      requestId !== undefined &&
      requestId !== ""
    );
  });

  async function respond(result: unknown) {
    const sessionIsCurrent = captureSessionEpoch();
    const hostId = unref(source.hostId);
    const threadId = unref(source.threadId);
    const requestId = unref(source.requestId);
    if (
      hostId === null ||
      hostId === undefined ||
      threadId === null ||
      threadId === undefined ||
      threadId === "" ||
      requestId === null ||
      requestId === undefined ||
      requestId === ""
    ) {
      store.setError(t("app.serverRequestMissingContext"), context.value);
      return false;
    }

    responding.value = true;
    try {
      await threadTurns.respondToServerRequest(hostId, threadId, requestId, result);
      if (!sessionIsCurrent()) return false;
      return true;
    } catch {
      // serverRequest.respond declares global notification ownership in the realtime transport.
      // Keep this composable responsible only for form state so one failure cannot create both a
      // request-level Sonner toast and a second component-level toast.
      return false;
    } finally {
      if (sessionIsCurrent()) responding.value = false;
    }
  }

  async function respondWithJson(text: string) {
    return await respondWithParsedJson(text, (value) => value);
  }

  async function respondWithParsedJson(text: string, buildResult: (value: unknown) => unknown) {
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      store.setError(t("app.invalidJsonResponse"), context.value);
      return false;
    }
    return await respond(buildResult(value));
  }

  return {
    canRespond,
    responding,
    respond,
    respondWithJson,
    respondWithParsedJson,
  };
}
