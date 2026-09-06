import { createError, defineEventHandler, getHeader, setHeader, type H3Event } from "h3";
import { ensureUserConfigLoaded } from "../http/errors";
import { runWithGatewayUser } from "../state/memory";
import {
  hasSupervisorPermission,
  supervisorGrantStore,
  type SupervisorGrant,
  type SupervisorPermission,
} from "./grants";

type SupervisorHandler<T> = (event: H3Event, grant: SupervisorGrant) => Promise<T> | T;

export function defineSupervisorEventHandler<T>(
  permission: SupervisorPermission,
  handler: SupervisorHandler<T>,
) {
  return defineEventHandler(async (event) => {
    const grant = authenticateSupervisorEvent(event);
    if (!hasSupervisorPermission(grant, permission)) {
      throw createError({
        statusCode: 403,
        statusMessage: "Forbidden",
        message: "Supervisor grant does not permit this operation",
      });
    }
    setHeader(event, "cache-control", "no-store");
    setHeader(event, "pragma", "no-cache");
    return await runWithGatewayUser(grant.userId, async () => {
      ensureUserConfigLoaded(grant.userId);
      try {
        return await handler(event, grant);
      } catch (error: unknown) {
        console.error("[gateway] scoped supervisor request failed", {
          grantId: grant.id,
          userId: grant.userId,
          hostId: grant.hostId,
          threadId: grant.threadId,
          error: error instanceof Error ? error.message : String(error),
        });
        if (clientErrorStatus(error) !== null) throw error;
        throw createError({
          statusCode: 502,
          statusMessage: "Bad Gateway",
          message: "Unable to access the supervised thread",
        });
      }
    });
  });
}

function authenticateSupervisorEvent(event: H3Event) {
  const authorization = getHeader(event, "authorization")?.trim() ?? "";
  const match = authorization.match(/^Supervisor\s+([A-Za-z0-9_-]+)$/);
  const token = match?.[1] ?? "";
  const grant = supervisorGrantStore.authenticate(token);
  if (grant === null) {
    throw createError({
      statusCode: 401,
      statusMessage: "Unauthorized",
      message: "Missing, invalid, expired, or revoked supervisor grant",
    });
  }
  return grant;
}

function clientErrorStatus(error: unknown) {
  if (typeof error !== "object" || error === null || !("statusCode" in error)) return null;
  const statusCode = Number(error.statusCode);
  return statusCode >= 400 && statusCode < 500 ? statusCode : null;
}
