import type { HostRecord } from "~~/shared/types";
import { INITIAL_TURN_PAGE_LIMIT } from "~~/shared/config";
import { randomUUID } from "node:crypto";
import type { ServerRequestResponseInput, TurnStartInput, TurnSteerInput } from "./types";
import type { ControllerRegistry } from "./controller-registry";
import { buildTurnStartParams, buildUserInput } from "../protocol/thread-payload";
import { runtimeLog } from "./runtime-log";
import type { ThreadOpenService } from "./thread-open-service";
import { recordFromUnknown, stringFromUnknown } from "~~/shared/utils/records";
import { trimmedOrFallback } from "~~/shared/utils/strings";
import { parseTurnStartResponse, parseTurnSteerResponse } from "~~/shared/runtime/app-server";
import { turnUsageAccounting } from "../usage/turn-usage-accounting";
import { chooseProvider } from "../provider-router/policy";
import { classifyOpenAiFailure } from "../provider-router/quota";
import { getProviderRouterState, updateProviderRouterState } from "../provider-router/state";
import { logProviderDecision } from "../provider-router/logging";
import type { ProviderDecision } from "../provider-router/types";
import type { ThreadController } from "./thread-controller";
import { deepseekModelForImage } from "../provider-router/models";

export class ThreadTurnCommandService {
  constructor(
    private readonly registry: ControllerRegistry,
    private readonly openService: ThreadOpenService,
  ) {}

  async startTurn(host: HostRecord, threadId: string, input: TurnStartInput) {
    const clientUserMessageId = trimmedOrFallback(
      input.clientUserMessageId,
      `gateway-${randomUUID()}`,
    );
    return this.registry.withScopedSubscription(host, threadId, async (controller) => {
      const startedAt = Date.now();
      let decision = chooseProvider(input);
      if (controller.isFreshThread() && decision.transport === "openrouter") {
        decision = {
          ...decision,
          transport: "deepseek",
          model: deepseekModelForImage(decision.containsImages),
          reason: "openrouter_deferred_until_thread_is_materialized",
        };
      }
      try {
        await controller.ensureProvider(
          decision.transport === "openai"
            ? "openai"
            : decision.transport === "openrouter"
              ? "openrouter"
              : "deepseek",
          decision.model,
        );
        const result = await this.startWithDecision(
          controller,
          host,
          threadId,
          clientUserMessageId,
          input,
          decision,
        );
        logProviderDecision(`turn-${clientUserMessageId}`, threadId, decision, {
          hostId: host.id,
          status: "200",
          durationMs: Date.now() - startedAt,
        });
        return result;
      } catch (error) {
        const classification = classifyOpenAiFailure(error);
        if (decision.transport === "deepseek" && isDeepSeekTransportFailure(error)) {
          updateProviderRouterState((state) => {
            state.directDeepseek = "unavailable";
          });
        }
        if (
          decision.effectiveProvider === "openai" &&
          decision.mode === "hybrid" &&
          classification.kind === "quota_exhausted" &&
          !controller.isActiveMainThread()
        ) {
          updateProviderRouterState((state) => {
            state.openaiQuota = "exhausted";
            state.openaiQuotaDetectedAt = new Date().toISOString();
            state.openaiQuotaResetAt = classification.resetAt;
            state.openaiQuotaReason = classification.reasonCode;
          });
          decision = chooseProvider(input);
          await controller.ensureProvider(
            decision.transport === "openrouter" ? "openrouter" : "deepseek",
            decision.model,
          );
          const result = await this.startWithDecision(
            controller,
            host,
            threadId,
            clientUserMessageId,
            input,
            decision,
          );
          logProviderDecision(`turn-${clientUserMessageId}`, threadId, decision, {
            hostId: host.id,
            status: "200",
            durationMs: Date.now() - startedAt,
            fallbackReason: "openai_quota_exhausted",
          });
          return result;
        }
        if (
          decision.effectiveProvider === "deepseek" &&
          decision.mode === "hybrid" &&
          decision.transport !== "openrouter" &&
          shouldFallbackToOpenAi(error, controller)
        ) {
          const fallbackDecision = hybridOpenAiFallbackDecision(input, decision);
          await controller.ensureProvider("openai", fallbackDecision.model);
          const result = await this.startWithDecision(
            controller,
            host,
            threadId,
            clientUserMessageId,
            input,
            fallbackDecision,
          );
          logProviderDecision(`turn-${clientUserMessageId}`, threadId, fallbackDecision, {
            hostId: host.id,
            status: "200",
            durationMs: Date.now() - startedAt,
            fallbackReason: "deepseek_unavailable_hybrid_openai_fallback",
          });
          return result;
        }
        if (decision.transport === "openrouter" && isOpenRouterTransportFailure(error)) {
          const creditExhausted = isOpenRouterCreditExhaustion(error);
          updateProviderRouterState((state) => {
            state.openrouter = creditExhausted ? "exhausted" : "unavailable";
            state.openrouterLastError = creditExhausted
              ? "openrouter_credit_exhausted"
              : classification.reasonCode;
          });
          decision = {
            ...decision,
            transport: "deepseek",
            model: deepseekModelForImage(decision.containsImages),
            reason: "openrouter_unavailable_direct_fallback",
          };
          await controller.ensureProvider("deepseek", decision.model);
          try {
            const result = await this.startWithDecision(
              controller,
              host,
              threadId,
              clientUserMessageId,
              input,
              decision,
            );
            logProviderDecision(`turn-${clientUserMessageId}`, threadId, decision, {
              hostId: host.id,
              status: "200",
              durationMs: Date.now() - startedAt,
              fallbackReason: creditExhausted
                ? "openrouter_credit_exhausted"
                : "openrouter_unavailable",
            });
            return result;
          } catch (directError) {
            if (isDeepSeekTransportFailure(directError)) {
              updateProviderRouterState((state) => {
                state.directDeepseek = "unavailable";
              });
            }
            if (decision.mode === "hybrid" && shouldFallbackToOpenAi(directError, controller)) {
              const fallbackDecision = hybridOpenAiFallbackDecision(input, decision);
              await controller.ensureProvider("openai", fallbackDecision.model);
              const result = await this.startWithDecision(
                controller,
                host,
                threadId,
                clientUserMessageId,
                input,
                fallbackDecision,
              );
              logProviderDecision(`turn-${clientUserMessageId}`, threadId, fallbackDecision, {
                hostId: host.id,
                status: "200",
                durationMs: Date.now() - startedAt,
                fallbackReason: creditExhausted
                  ? "openrouter_and_deepseek_unavailable_hybrid_openai_fallback"
                  : "deepseek_unavailable_hybrid_openai_fallback",
              });
              return result;
            }
            throw directError;
          }
        }
        logProviderDecision(`turn-${clientUserMessageId}`, threadId, decision, {
          status: "error",
          durationMs: Date.now() - startedAt,
        });
        throw error;
      }
    });
  }

  private startWithDecision(
    controller: ThreadController,
    host: HostRecord,
    threadId: string,
    clientUserMessageId: string,
    input: TurnStartInput,
    decision: ProviderDecision,
  ) {
    const routedInput = { ...input, model: decision.model };
    return controller
      .enqueue(() =>
        controller.client.request(
          "turn/start",
          buildTurnStartParams(threadId, clientUserMessageId, routedInput),
          120_000,
          parseTurnStartResponse,
        ),
      )
      .then((result) => {
        const startedTurn = recordFromUnknown(result)?.turn;
        const turnId = stringFromUnknown(recordFromUnknown(startedTurn)?.id);
        if (turnId !== null) {
          turnUsageAccounting.registerTurnMetadata(host.id, threadId, turnId, {
            model: decision.model ?? null,
            effort: input.effort ?? null,
            serviceTier: input.serviceTier ?? null,
          });
        }
        controller.markActiveMainThread();
        return result;
      });
  }

  async steerTurn(host: HostRecord, threadId: string, input: TurnSteerInput) {
    const clientUserMessageId = trimmedOrFallback(
      input.clientUserMessageId,
      `gateway-steer-${randomUUID()}`,
    );
    return this.registry
      .withScopedSubscription(host, threadId, async (controller) => {
        const result = await controller.enqueue(() =>
          controller.client.request(
            "turn/steer",
            {
              threadId,
              expectedTurnId: input.expectedTurnId,
              clientUserMessageId,
              input: buildUserInput(input),
              additionalContext: input.additionalContext ?? {},
            },
            120_000,
            parseTurnSteerResponse,
          ),
        );
        const turnId = stringFromUnknown(recordFromUnknown(result)?.turnId);
        if (turnId !== null) {
          turnUsageAccounting.registerTurnMetadata(host.id, threadId, turnId, {
            model: null,
            effort: null,
            serviceTier: null,
          });
        }
        controller.markActiveMainThread();
        return result;
      })
      .catch(async (error) => {
        if (isNoActiveTurnToSteer(error)) {
          runtimeLog("refreshing thread after stale steer state", {
            hostId: host.id,
            threadId,
            expectedTurnId: input.expectedTurnId,
          });
          await this.openService.refreshThreadState(host, threadId, null, INITIAL_TURN_PAGE_LIMIT);
        }
        throw error;
      });
  }

  async interruptTurn(host: HostRecord, threadId: string, turnId: string) {
    return this.registry.withScopedSubscription(host, threadId, (controller) =>
      controller.enqueue(() =>
        controller.client.request("turn/interrupt", {
          threadId,
          turnId,
        }),
      ),
    );
  }

  async respondToServerRequest(
    host: HostRecord,
    threadId: string,
    input: ServerRequestResponseInput,
  ) {
    const client = await this.registry.getHostClient(host);
    if (input.error) {
      client.respondError(input.requestId, input.error.code, input.error.message, input.error.data);
    } else {
      client.respond(input.requestId, input.result ?? {});
    }
  }
}

function isNoActiveTurnToSteer(error: unknown) {
  const record = recordFromUnknown(error);
  const message = stringFromUnknown(record?.message);
  return (
    record?.rpcMethod === "turn/steer" &&
    message !== null &&
    message.toLowerCase().includes("no active turn")
  );
}

function isOpenRouterTransportFailure(error: unknown) {
  const record = recordFromUnknown(error);
  const values = [
    stringFromUnknown(record?.message),
    stringFromUnknown(record?.rpcData),
    stringFromUnknown(record?.data),
    record?.rpcData === undefined ? null : JSON.stringify(record.rpcData),
    record?.data === undefined ? null : JSON.stringify(record.data),
    error instanceof Error ? error.message : null,
  ]
    .filter((value): value is string => value !== null)
    .join(" ")
    .toLowerCase();
  return /openrouter|missing.*(?:api|key)|provider.*(?:unavailable|unknown)|invalid.*model|unauthori[sz]ed|forbidden|insufficient.*(?:credit|balance)|(?:credit|balance).*(?:exhaust|deplet|insufficient)|payment required/.test(
    values,
  );
}

/**
 * Hybrid mode may preserve usability when a remote app-server has no DeepSeek credential or has
 * not reloaded its provider table. This is deliberately disabled for DeepSeek-only mode and never
 * runs after a turn became active, so it cannot replay tool side effects.
 */
function shouldFallbackToOpenAi(error: unknown, controller: ThreadController) {
  if (process.env.CODEX_PROVIDER_HYBRID_OPENAI_FALLBACK === "false") return false;
  if (controller.isActiveMainThread()) return false;
  if (getProviderRouterState().openaiQuota === "exhausted") return false;
  return isDeepSeekTransportFailure(error);
}

function hybridOpenAiFallbackDecision(input: TurnStartInput, previous: ProviderDecision) {
  const model =
    input.model !== null && input.model !== undefined && !input.model.startsWith("deepseek")
      ? input.model
      : null;
  return {
    ...previous,
    logicalProvider: "openai" as const,
    effectiveProvider: "openai" as const,
    transport: "openai" as const,
    model,
    reason: "deepseek_unavailable_hybrid_openai_fallback",
  };
}

function isDeepSeekTransportFailure(error: unknown) {
  const record = recordFromUnknown(error);
  const values = [
    stringFromUnknown(record?.message),
    stringFromUnknown(record?.rpcData),
    stringFromUnknown(record?.data),
    record?.rpcData === undefined ? null : JSON.stringify(record.rpcData),
    record?.data === undefined ? null : JSON.stringify(record.data),
    error instanceof Error ? error.message : null,
  ]
    .filter((value): value is string => value !== null)
    .join(" ")
    .toLowerCase();
  return /resumed provider .* expected deepseek|deepseek.*(?:missing|not configured|unavailable|unauthori[sz]ed|forbidden|api[ _-]?key)|(?:missing|invalid|unauthori[sz]ed|forbidden).*(?:api[ _-]?key|provider|deepseek)|(?:provider|model).*(?:not found|unavailable|unknown)/.test(
    values,
  );
}

function isOpenRouterCreditExhaustion(error: unknown) {
  const record = recordFromUnknown(error);
  const status = record?.status ?? record?.statusCode ?? record?.httpStatus;
  const values = [
    stringFromUnknown(record?.message),
    stringFromUnknown(record?.rpcData),
    stringFromUnknown(record?.data),
    record?.rpcData === undefined ? null : JSON.stringify(record.rpcData),
    record?.data === undefined ? null : JSON.stringify(record.data),
    error instanceof Error ? error.message : null,
  ]
    .filter((value): value is string => value !== null)
    .join(" ")
    .toLowerCase();
  return (
    status === 402 ||
    /insufficient.*(?:credit|balance)|(?:credit|balance).*(?:exhaust|deplet|insufficient)|payment required/.test(
      values,
    )
  );
}
