import { createError, getHeader, type H3Event } from "h3";
import type { AuthenticatedUser } from "./users";
import { userStore } from "./users";
import { trimmedOrFallback } from "~~/shared/utils/strings";

export function tokenFromEvent(event: H3Event) {
  const authorization = trimmedOrFallback(getHeader(event, "authorization"), "");
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (match?.[1] !== undefined) {
    return match[1].trim();
  }
  return "";
}

export function authenticateEvent(event: H3Event) {
  const token = tokenFromEvent(event);
  const user = userStore.authenticateToken(token);
  if (user === null) {
    throw createError({
      statusCode: 401,
      statusMessage: "Unauthorized",
      message: "Missing or invalid bearer token",
    });
  }
  event.context.auth = { user, token };
  return user;
}

export function optionalAuthenticatedUser(event: H3Event) {
  const token = tokenFromEvent(event);
  if (token === "") {
    return null;
  }
  const user = userStore.authenticateToken(token);
  if (user !== null) {
    event.context.auth = { user, token };
  }
  return user;
}

export function requireAuthenticatedUser(event: H3Event): AuthenticatedUser {
  const user = event.context.auth?.user;
  if (!user) {
    return authenticateEvent(event);
  }
  return user;
}
