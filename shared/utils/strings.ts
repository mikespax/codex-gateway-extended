export function trimmedOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed === "" || trimmed === undefined ? null : trimmed;
}

export function trimmedOrFallback(value: string | null | undefined, fallback: string): string {
  return trimmedOrNull(value) ?? fallback;
}

export function firstNonEmptyString(values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const trimmed = trimmedOrNull(value);
    if (trimmed !== null) return trimmed;
  }
  return null;
}
