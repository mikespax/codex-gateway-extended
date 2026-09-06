// All remote shell payloads pass dynamic values through this POSIX quoting boundary.
export function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
