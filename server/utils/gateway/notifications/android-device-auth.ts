import { createError, getHeader, type H3Event } from "h3";
import { androidDeviceRepository } from "./android-device-repository";

export function requireAndroidDevice(event: H3Event) {
  const authorization = (getHeader(event, "authorization") ?? "").trim();
  const match = authorization.match(/^Device\s+(.+)$/i);
  const token = match?.[1]?.trim() ?? "";
  const device = token === "" ? null : androidDeviceRepository.authenticate(token);
  if (device === null) {
    throw createError({
      statusCode: 401,
      statusMessage: "Unauthorized",
      message: "Missing or invalid Android device token",
    });
  }
  return device;
}
