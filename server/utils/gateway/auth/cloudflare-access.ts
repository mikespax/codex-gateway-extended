import { createPublicKey, createVerify } from "node:crypto";
import type { H3Event } from "h3";
import { getHeader } from "h3";

const ACCESS_JWT_HEADER = "cf-access-jwt-assertion";
const ACCESS_EMAIL_HEADER = "cf-access-authenticated-user-email";
const JWKS_CACHE_MS = 60 * 60_000;
const REQUEST_TIMEOUT_MS = 5_000;

interface HeaderSource {
  get(name: string): string | null | undefined;
}

interface CloudflareAccessClaims {
  iss: string;
  aud: string[];
  email: string;
  exp: number;
  iat?: number;
  nbf?: number;
}

interface CloudflareAccessJwk {
  kid: string;
  kty: string;
  alg?: string;
  n: string;
  e: string;
}

interface CachedJwks {
  issuer: string;
  expiresAt: number;
  keys: CloudflareAccessJwk[];
}

export interface CloudflareAccessIdentity {
  email: string;
}

let cachedJwks: CachedJwks | null = null;
let jwksRequest: Promise<CloudflareAccessJwk[]> | null = null;

/**
 * Verify the identity that Cloudflare Access injects at the origin. The email header alone is
 * not trusted: the accompanying Access JWT must have a valid signature, issuer, expiry, and
 * matching email claim. This keeps direct LAN requests from bypassing the Gateway auth boundary.
 */
export async function cloudflareAccessIdentityFromEvent(
  event: H3Event,
): Promise<CloudflareAccessIdentity | null> {
  return cloudflareAccessIdentityFromHeaders({
    get(name: string) {
      return getHeader(event, name);
    },
  });
}

export async function cloudflareAccessIdentityFromHeaders(
  headers: HeaderSource,
): Promise<CloudflareAccessIdentity | null> {
  const email = normalizeEmail(headers.get(ACCESS_EMAIL_HEADER));
  const assertion = headers.get(ACCESS_JWT_HEADER)?.trim() ?? "";
  if (email === null || assertion === "") {
    return null;
  }

  const parsed = parseJwt(assertion);
  if (parsed === null) {
    return null;
  }
  const { header, claims, signingInput, signature } = parsed;
  const issuer = configuredIssuer();
  if (issuer === null || header.alg !== "RS256" || claims.iss !== issuer) {
    return null;
  }
  if (!claims.aud.length || !validTimeClaims(claims) || normalizeEmail(claims.email) !== email) {
    return null;
  }

  const configuredAudience = process.env.CODEX_GATEWAY_CLOUDFLARE_ACCESS_AUDIENCE?.trim();
  if (
    configuredAudience !== undefined &&
    configuredAudience !== "" &&
    !claims.aud.includes(configuredAudience)
  ) {
    return null;
  }

  const verified = await verifySignature(issuer, header.kid, signingInput, signature);
  return verified ? { email } : null;
}

function configuredIssuer() {
  const value = process.env.CODEX_GATEWAY_CLOUDFLARE_ACCESS_ISSUER?.trim() ?? "";
  if (value === "") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.search || url.hash) {
      return null;
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function parseJwt(assertion: string) {
  const parts = assertion.split(".");
  if (
    parts.length !== 3 ||
    parts[0] === undefined ||
    parts[1] === undefined ||
    parts[2] === undefined ||
    parts[0] === "" ||
    parts[1] === "" ||
    parts[2] === ""
  ) {
    return null;
  }
  try {
    const header = parseJsonSegment(parts[0]);
    const claims = parseJsonSegment(parts[1]);
    if (!isRecord(header) || !isRecord(claims)) {
      return null;
    }
    const kid = stringValue(header.kid);
    const iss = stringValue(claims.iss);
    const email = stringValue(claims.email);
    const aud = audienceValues(claims.aud);
    const exp = numberValue(claims.exp);
    if (kid === null || iss === null || email === null || aud.length === 0 || exp === null) {
      return null;
    }
    const iat = numberValue(claims.iat);
    const nbf = numberValue(claims.nbf);
    return {
      header: { alg: stringValue(header.alg), kid },
      claims: {
        iss,
        aud,
        email,
        exp,
        ...(iat === null ? {} : { iat }),
        ...(nbf === null ? {} : { nbf }),
      },
      signingInput: `${parts[0]}.${parts[1]}`,
      signature: Buffer.from(parts[2], "base64url"),
    };
  } catch {
    return null;
  }
}

function parseJsonSegment(segment: string): unknown {
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
}

function audienceValues(value: unknown) {
  if (typeof value === "string" && value.trim()) return [value.trim()];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim() !== "");
}

function validTimeClaims(claims: CloudflareAccessClaims) {
  const now = Date.now() / 1_000;
  if (claims.exp <= now) return false;
  if (claims.iat !== undefined && claims.iat > now + 300) return false;
  if (claims.nbf !== undefined && claims.nbf > now + 300) return false;
  return true;
}

async function verifySignature(
  issuer: string,
  kid: string,
  signingInput: string,
  signature: Buffer,
) {
  let keys = await loadJwks(issuer);
  let key = keys.find((candidate) => candidate.kid === kid);
  if (!key) {
    cachedJwks = null;
    keys = await loadJwks(issuer);
    key = keys.find((candidate) => candidate.kid === kid);
  }
  if (!key) return false;
  try {
    const verifier = createVerify("RSA-SHA256");
    verifier.update(signingInput);
    verifier.end();
    return verifier.verify(createPublicKey({ key, format: "jwk" }), signature);
  } catch {
    return false;
  }
}

async function loadJwks(issuer: string): Promise<CloudflareAccessJwk[]> {
  if (cachedJwks && cachedJwks.issuer === issuer && cachedJwks.expiresAt > Date.now()) {
    return cachedJwks.keys;
  }
  if (jwksRequest) return jwksRequest;
  jwksRequest = fetchJwks(issuer);
  try {
    const keys = await jwksRequest;
    cachedJwks = { issuer, expiresAt: Date.now() + JWKS_CACHE_MS, keys };
    return keys;
  } finally {
    jwksRequest = null;
  }
}

async function fetchJwks(issuer: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${issuer}/cdn-cgi/access/certs`, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) return [];
    const body: unknown = await response.json();
    if (!isRecord(body) || !Array.isArray(body.keys)) return [];
    return body.keys.filter(isAccessJwk);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

function isAccessJwk(value: unknown): value is CloudflareAccessJwk {
  if (!isRecord(value)) return false;
  return (
    stringValue(value.kid) !== null &&
    stringValue(value.kty) === "RSA" &&
    stringValue(value.n) !== null &&
    stringValue(value.e) !== null
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeEmail(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase() ?? "";
  return normalized.includes("@") ? normalized : null;
}
