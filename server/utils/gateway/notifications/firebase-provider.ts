import { readFileSync } from "node:fs";
import { sign } from "node:crypto";
import type { ServerNotification } from "~~/shared/types";
import { z } from "zod";
import type { AndroidDevice } from "./android-device-repository";
import { androidReplyAllowed } from "./android-device-repository";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const REQUEST_TIMEOUT_MS = 10_000;

interface FirebaseServiceAccount {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

interface CachedAccessToken {
  value: string;
  expiresAt: number;
}

const oauthResponseSchema = z.object({
  access_token: z.string().optional(),
  expires_in: z.number().optional(),
  error_description: z.string().optional(),
});

const firebaseServiceAccountSchema = z.object({
  project_id: z.string().trim().min(1),
  client_email: z.string().trim().min(1),
  private_key: z.string().trim().min(1),
});

let cachedCredentials: { path: string; value: FirebaseServiceAccount } | null = null;
let cachedAccessToken: CachedAccessToken | null = null;

export class FirebaseRequestError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "FirebaseRequestError";
  }
}

export function firebaseConfigured() {
  return firebaseCredentialsPath() !== "";
}

export async function sendFirebaseNotification(
  device: AndroidDevice,
  notification: ServerNotification,
) {
  const credentials = firebaseCredentials();
  const accessToken = await firebaseAccessToken(credentials);
  const target = notification.target;
  const response = await fetch(
    `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(credentials.projectId)}/messages:send`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        message: {
          token: device.fcmToken,
          data: {
            type: "codex_gateway_notification",
            notificationKey: notification.key,
            title: notification.title,
            body: notification.body,
            targetKind: target.kind,
            hostId: String(target.hostId),
            projectId: target.projectId === null ? "" : String(target.projectId),
            threadId: target.threadId ?? "",
            replyAllowed: androidReplyAllowed(notification) ? "true" : "false",
          },
          android: {
            priority: "HIGH",
            ttl: "3600s",
          },
        },
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );
  if (!response.ok) {
    const details = (await response.text()).trim().slice(0, 500);
    throw new FirebaseRequestError(
      `FCM send failed with HTTP ${response.status}${details === "" ? "" : `: ${details}`}`,
      response.status === 408 || response.status === 429 || response.status >= 500,
    );
  }
}

async function firebaseAccessToken(credentials: FirebaseServiceAccount) {
  if (cachedAccessToken !== null && cachedAccessToken.expiresAt > Date.now() + 60_000) {
    return cachedAccessToken.value;
  }
  const issuedAt = Math.floor(Date.now() / 1000);
  const assertion = signedJwt(credentials, issuedAt);
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  });
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const payload = oauthResponseSchema.parse(await response.json());
  if (!response.ok || payload.access_token === undefined) {
    const description = payload.error_description?.slice(0, 500) ?? "";
    throw new FirebaseRequestError(
      `Firebase OAuth failed with HTTP ${response.status}${description === "" ? "" : `: ${description}`}`,
      response.status === 408 || response.status === 429 || response.status >= 500,
    );
  }
  const expiresIn = payload.expires_in ?? 3_600;
  cachedAccessToken = {
    value: payload.access_token,
    expiresAt: Date.now() + Math.max(60, expiresIn) * 1_000,
  };
  return cachedAccessToken.value;
}

function signedJwt(credentials: FirebaseServiceAccount, issuedAt: number) {
  const header = base64UrlJson({ alg: "RS256", typ: "JWT" });
  const claims = base64UrlJson({
    iss: credentials.clientEmail,
    scope: FCM_SCOPE,
    aud: GOOGLE_TOKEN_URL,
    iat: issuedAt,
    exp: issuedAt + 3_600,
  });
  const unsigned = `${header}.${claims}`;
  const signature = sign("RSA-SHA256", Buffer.from(unsigned), credentials.privateKey).toString(
    "base64url",
  );
  return `${unsigned}.${signature}`;
}

function firebaseCredentials() {
  const path = firebaseCredentialsPath();
  if (path === "") {
    throw new Error("CODEX_GATEWAY_FIREBASE_CREDENTIALS_PATH is not configured");
  }
  if (cachedCredentials?.path === path) return cachedCredentials.value;
  const parsed = firebaseServiceAccountSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  const projectId = parsed.project_id;
  const clientEmail = parsed.client_email;
  const privateKey = parsed.private_key;
  const value = { projectId, clientEmail, privateKey };
  cachedCredentials = { path, value };
  cachedAccessToken = null;
  return value;
}

function firebaseCredentialsPath() {
  return (process.env.CODEX_GATEWAY_FIREBASE_CREDENTIALS_PATH ?? "").trim();
}

function base64UrlJson(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
