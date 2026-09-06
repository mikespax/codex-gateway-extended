import { z } from "zod";

// Zod 4's record schema intentionally accepts only plain records. Gateway boundaries also inspect
// typed Error instances from SSH2, H3, and app-server transports, whose custom enumerable fields
// still form a valid string-keyed object. Built-in Error fields such as message are non-enumerable
// and must be read through the standard Error contract by callers. A loose object schema preserves
// custom fields without accepting arrays or primitives, avoiding duplicated unsafe property access.
const unknownRecordSchema = z.looseObject({});

export function recordFromUnknown(value: unknown): Record<string, unknown> | null {
  const result = unknownRecordSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function idFromUnknown(value: unknown): string | number | null {
  return typeof value === "string" || typeof value === "number" ? value : null;
}

export function stringIdFromUnknown(value: unknown): string | null {
  const id = idFromUnknown(value);
  return id === null ? null : String(id);
}

export function stringFromUnknown(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
