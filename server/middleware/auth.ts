import { defineEventHandler, getRequestURL } from "h3";
import { authenticateEvent } from "../utils/gateway/auth/context";

const PUBLIC_API_PATHS = new Set([
  "/api/auth/login",
  "/api/realtime",
  "/api/supervisor/thread",
  "/api/supervisor/thread/events",
  "/api/supervisor/thread/message",
  "/api/android/device/revoke",
  "/api/android/device/reply",
  "/api/android/device/token",
]);

export default defineEventHandler((event) => {
  const path = getRequestURL(event).pathname;
  if (!path.startsWith("/api/") || PUBLIC_API_PATHS.has(path)) {
    return;
  }
  authenticateEvent(event);
});
