import { createError, setHeader } from "h3";
import { cloudflareAccessIdentityFromEvent } from "../../utils/gateway/auth/cloudflare-access";
import { userStore } from "../../utils/gateway/auth/users";

export default defineEventHandler(async (event) => {
  setHeader(event, "cache-control", "no-store");
  const identity = await cloudflareAccessIdentityFromEvent(event);
  if (!identity) {
    throw createError({
      statusCode: 401,
      statusMessage: "Unauthorized",
      message: "A valid Cloudflare Access session is required",
    });
  }
  const user = userStore.findSingleActiveUser();
  if (!user) {
    throw createError({
      statusCode: 503,
      statusMessage: "Gateway account unavailable",
      message: "Cloudflare Access identity cannot be mapped to exactly one active Gateway account",
    });
  }
  return userStore.createSession(user);
});
