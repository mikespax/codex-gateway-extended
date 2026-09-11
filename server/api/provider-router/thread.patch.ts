import { getValidatedQuery, readValidatedBody } from "h3";
import { z } from "zod";
import { defineGatewayEventHandler } from "../../utils/gateway/http/errors";
import { requireRecord } from "../../utils/gateway/http/validation/common";
import { hostStore } from "../../utils/gateway/state/hosts";
import {
  getThreadProviderRouting,
  setThreadProviderRouting,
} from "../../utils/gateway/provider-router/state";
import { providerRouterStatus } from "../../utils/gateway/provider-router/policy";
import { normalizeProviderRouting } from "~~/shared/config";

const querySchema = z.object({
  hostId: z.coerce.number().int().positive(),
  threadId: z.string().trim().min(1).max(128),
});

const bodySchema = z
  .object({
    mode: z.enum(["openai", "hybrid", "deepseek"]).nullable(),
    useOpenRouterCreditsFirst: z.boolean().optional(),
  })
  .strict();

export default defineGatewayEventHandler(async (event) => {
  const query = await getValidatedQuery(event, (value) => querySchema.parse(value));
  const body = await readValidatedBody(event, (value) => bodySchema.parse(value));
  requireRecord(hostStore.get(query.hostId), "Host not found");
  const settings =
    body.mode === null
      ? null
      : normalizeProviderRouting({
          mode: body.mode,
          useOpenRouterCreditsFirst: body.useOpenRouterCreditsFirst,
        });
  setThreadProviderRouting(query.hostId, query.threadId, settings);
  const override = getThreadProviderRouting(query.hostId, query.threadId);
  return {
    override,
    effective: providerRouterStatus(new Date(), override),
  };
});
