import { posix } from "node:path";
import pLimit from "p-limit";
import type { GatewayThread, HostRecord } from "~~/shared/types";
import type { CommandResult } from "../ssh/ssh-types";
import { remoteLoginShellCommand } from "../ssh/remote-command";
import { shellQuote } from "../ssh/shell";
import type { SshConnectionPool } from "../ssh/ssh-connection";

// Thread size is advisory UI metadata, not live state. Keep the value stable across sidebar
// refreshes and conversation opens; a six-hour refresh is enough to surface meaningful growth
// without repeatedly walking large rollout files over SSH. The displayed value is the persisted
// rollout file itself; attachment payloads are intentionally not re-parsed in the remote shell.
export const THREAD_STORAGE_CACHE_TTL_MS = 6 * 60 * 60 * 1_000;
export const THREAD_STORAGE_SCAN_TIMEOUT_MS = 15_000;
export const THREAD_STORAGE_MAX_OUTPUT_BYTES = 128 * 1024;
export const THREAD_STORAGE_MAX_CONCURRENT_SCANS = 1;

export type ThreadStorageCandidate = Pick<GatewayThread, "id" | "path">;

type CachedHostSizes = {
  expiresAt: number;
  values: Map<string, number | null>;
};

type Clock = () => number;

/**
 * Best-effort remote storage accounting for the sidebar. A single bounded SSH command scans all
 * uncached paths for a host. The command never receives a project cwd and validates every rollout
 * against the host's CODEX_HOME sessions roots before reading it.
 */
export class ThreadStorageScanner {
  private readonly cache = new Map<number, CachedHostSizes>();
  private readonly inFlight = new Map<number, Promise<Map<string, number | null>>>();
  private readonly scanLimit = pLimit(THREAD_STORAGE_MAX_CONCURRENT_SCANS);

  constructor(
    private readonly ssh: Pick<SshConnectionPool, "exec">,
    private readonly now: Clock = () => Date.now(),
  ) {}

  /** Return only already-cached values; never performs I/O or waits on a remote scan. */
  cached(host: HostRecord, threads: readonly ThreadStorageCandidate[]) {
    const requested = requestedPaths(threads);
    if (requested.size === 0) return new Map<string, number | null>();
    const entry = this.cache.get(host.id);
    if (entry === undefined) {
      return new Map([...requested.keys()].map((id) => [id, null] as const));
    }
    // Keep the last successful measurement visible while the six-hour refresh runs. A transient
    // SSH failure should never turn a known size back into a dash.
    return selectValues(requested, entry.values);
  }

  /**
   * Report whether this host has uncached, resolvable rollout paths. The list endpoint uses this
   * to let the browser schedule one follow-up refresh after the advisory background scan finishes.
   * This keeps the authoritative thread list fast without leaving the first `—` placeholder in
   * the sidebar indefinitely.
   */
  needsRefresh(host: HostRecord, threads: readonly ThreadStorageCandidate[]) {
    const requested = requestedPaths(threads);
    const resolvable = [...requested].filter(([, path]) => path !== null);
    if (resolvable.length === 0) return false;
    const entry = this.cache.get(host.id);
    if (entry === undefined || entry.expiresAt <= this.now()) return true;
    return resolvable.some(([id]) => !entry.values.has(id));
  }

  async scan(host: HostRecord, threads: readonly ThreadStorageCandidate[]) {
    const requested = requestedPaths(threads);
    if (requested.size === 0) return new Map<string, number | null>();

    const cached = this.cache.get(host.id);
    if (cached !== undefined && cached.expiresAt > this.now()) {
      const missing = [...requested.keys()].filter((id) => !cached.values.has(id));
      if (missing.length === 0) return selectValues(requested, cached.values);
    }

    const previous = this.inFlight.get(host.id);
    if (previous !== undefined) {
      await previous.catch(() => undefined);
      const afterWait = this.cache.get(host.id);
      if (afterWait !== undefined && afterWait.expiresAt > this.now()) {
        const missing = [...requested.keys()].filter((id) => !afterWait.values.has(id));
        if (missing.length === 0) return selectValues(requested, afterWait.values);
      }
    }

    const promise = this.scanLimit(() => this.scanMissing(host, requested));
    this.inFlight.set(host.id, promise);
    try {
      return await promise;
    } finally {
      if (this.inFlight.get(host.id) === promise) this.inFlight.delete(host.id);
    }
  }

  clear(hostId?: number) {
    if (hostId === undefined) this.cache.clear();
    else this.cache.delete(hostId);
  }

  private async scanMissing(host: HostRecord, requested: Map<string, string | null>) {
    const current = this.cache.get(host.id);
    const cacheFresh = current !== undefined && current.expiresAt > this.now();
    const values =
      current === undefined ? new Map<string, number | null>() : new Map(current.values);
    const candidates = [...requested].filter(([id]) => !cacheFresh || !values.has(id));
    if (candidates.length === 0) return selectValues(requested, values);
    const resolvable: Array<[string, string]> = [];
    for (const [id, path] of candidates) {
      if (path !== null) resolvable.push([id, path]);
    }
    // A path that temporarily disappears is treated like a failed refresh: retain a previous
    // measurement when one exists, otherwise expose the neutral null value.
    for (const [id, path] of candidates) if (path === null && !values.has(id)) values.set(id, null);
    if (resolvable.length === 0) {
      this.cache.set(host.id, { expiresAt: this.now() + THREAD_STORAGE_CACHE_TTL_MS, values });
      return selectValues(requested, values);
    }

    let scanned: CommandResult;
    try {
      scanned = await this.ssh.exec(
        host,
        buildThreadStorageScanCommand(resolvable.map(([id, path]) => ({ id, path }))),
        {
          timeoutMs: THREAD_STORAGE_SCAN_TIMEOUT_MS,
          maxOutputBytes: THREAD_STORAGE_MAX_OUTPUT_BYTES,
        },
      );
    } catch {
      // Storage is advisory. Cache a neutral result after a timeout or SSH error so repeated list
      // refreshes cannot create an unbounded queue of identical remote scans.
      for (const [id] of resolvable) if (!values.has(id)) values.set(id, null);
      this.cache.set(host.id, { expiresAt: this.now() + THREAD_STORAGE_CACHE_TTL_MS, values });
      return selectValues(requested, values);
    }
    if (scanned.code !== 0) {
      for (const [id] of resolvable) if (!values.has(id)) values.set(id, null);
      this.cache.set(host.id, { expiresAt: this.now() + THREAD_STORAGE_CACHE_TTL_MS, values });
      return selectValues(requested, values);
    }
    const parsed = parseThreadStorageScanOutput(
      scanned.stdout,
      resolvable.map(([id]) => id),
    );
    for (const [id, size] of parsed) values.set(id, size);
    // A missing or unsafe path is cached as null for the same short interval, preventing a broken
    // rollout from turning each sidebar refresh into another remote request.
    for (const [id] of candidates) if (!values.has(id)) values.set(id, null);
    this.cache.set(host.id, { expiresAt: this.now() + THREAD_STORAGE_CACHE_TTL_MS, values });
    return selectValues(requested, values);
  }
}

export function createThreadStorageScanner(ssh: Pick<SshConnectionPool, "exec">) {
  return new ThreadStorageScanner(ssh);
}

function requestedPaths(threads: readonly ThreadStorageCandidate[]) {
  return new Map(
    threads
      .filter((thread) => typeof thread.id === "string" && thread.id.length > 0)
      .map((thread) => {
        const path = thread.path?.trim();
        return [thread.id, path === undefined || path === "" ? null : path] as const;
      }),
  );
}

function selectValues(requested: Map<string, string | null>, values: Map<string, number | null>) {
  return new Map([...requested.keys()].map((id) => [id, values.get(id) ?? null] as const));
}

export function parseThreadStorageScanOutput(output: string, ids: readonly string[]) {
  const values = new Map<string, number | null>();
  for (const line of output.split(/\r?\n/)) {
    const match = /^(\d+)\t(\d+)$/.exec(line.trim());
    if (match === null) continue;
    const index = Number(match[1]);
    const bytes = Number(match[2]);
    const id = ids[index];
    if (id === undefined || !Number.isSafeInteger(bytes) || bytes < 0) continue;
    values.set(id, bytes);
  }
  return values;
}

export function buildThreadStorageScanCommand(
  candidates: readonly { id: string; path: string | null }[],
) {
  const paths = candidates
    .map((candidate) => candidate.path)
    .filter((path): path is string => path !== null);
  const payload = `
set -u
codex_home="\${CODEX_HOME:-$HOME/.codex}"
sessions_root="$codex_home/sessions"
archived_root="$codex_home/archived_sessions"

real_path() {
  realpath -e -- "$1" 2>/dev/null || realpath -- "$1" 2>/dev/null || true
}
file_bytes() {
  value="$(stat -c %s -- "$1" 2>/dev/null || stat -f %z "$1" 2>/dev/null || true)"
  case "$value" in
    ''|*[!0-9]*) return 1 ;;
    *) printf '%s' "$value" ;;
  esac
}
inside_root() {
  case "$1" in
    "$2"/*) return 0 ;;
    *) return 1 ;;
  esac
}
index=0
for input do
  resolved="$(real_path "$input")"
  if [ -z "$resolved" ] || ! [ -f "$resolved" ]; then
    index=$((index + 1)); continue
  fi
  if ! inside_root "$resolved" "$sessions_root" && ! inside_root "$resolved" "$archived_root"; then
    index=$((index + 1)); continue
  fi
  total="$(file_bytes "$resolved" || true)"
  case "$total" in ''|*[!0-9]*) index=$((index + 1)); continue ;; esac
  printf '%s\\t%s\\n' "$index" "$total"
  index=$((index + 1))
done
`;
  return remoteLoginShellCommand(
    `sh -c ${shellQuote(payload)} sh ${paths.map(shellQuote).join(" ")}`,
  );
}

export function isThreadStoragePathInCodexSessions(path: string, codexHome: string) {
  const normalized = posix.normalize(path);
  const home = posix.normalize(codexHome);
  return [posix.join(home, "sessions"), posix.join(home, "archived_sessions")].some((root) =>
    normalized.startsWith(`${root}/`),
  );
}
