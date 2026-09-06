import { posix } from "node:path";
import pLimit from "p-limit";
import type { GatewayThread, HostRecord } from "~~/shared/types";
import { remoteLoginShellCommand } from "../ssh/remote-command";
import { shellQuote } from "../ssh/shell";
import type { SshConnectionPool } from "../ssh/ssh-connection";

export const THREAD_STORAGE_CACHE_TTL_MS = 60_000;
export const THREAD_STORAGE_SCAN_TIMEOUT_MS = 60_000;
export const THREAD_STORAGE_MAX_OUTPUT_BYTES = 128 * 1024;
export const THREAD_STORAGE_MAX_CONCURRENT_SCANS = 4;

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

  async scan(host: HostRecord, threads: readonly ThreadStorageCandidate[]) {
    const requested = new Map(
      threads
        .filter((thread) => typeof thread.id === "string" && thread.id.length > 0)
        .map((thread) => {
          const path = thread.path?.trim();
          return [thread.id, path === undefined || path === "" ? null : path] as const;
        }),
    );
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
    const values =
      current !== undefined && current.expiresAt > this.now()
        ? new Map(current.values)
        : new Map<string, number | null>();
    const candidates = [...requested].filter(([id]) => !values.has(id));
    if (candidates.length === 0) return selectValues(requested, values);
    const resolvable: Array<[string, string]> = [];
    for (const [id, path] of candidates) {
      if (path !== null) resolvable.push([id, path]);
    }
    for (const [id, path] of candidates) if (path === null) values.set(id, null);
    if (resolvable.length === 0) {
      this.cache.set(host.id, { expiresAt: this.now() + THREAD_STORAGE_CACHE_TTL_MS, values });
      return selectValues(requested, values);
    }

    const scanned = await this.ssh.exec(
      host,
      buildThreadStorageScanCommand(resolvable.map(([id, path]) => ({ id, path }))),
      {
        timeoutMs: THREAD_STORAGE_SCAN_TIMEOUT_MS,
        maxOutputBytes: THREAD_STORAGE_MAX_OUTPUT_BYTES,
      },
    );
    if (scanned.code !== 0) {
      throw new Error("Remote thread storage scan failed");
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
attachment_root="$codex_home/attachments"

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
directory_bytes() {
  value="$(du -sk -- "$1" 2>/dev/null | awk 'NR == 1 { print $1 * 1024; exit }')"
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
attachment_bytes() {
  reference="$1"
  candidate="$(printf '%s\\n' "$reference" | sed -e 's/[|,;)}]*$//' -e 's/:[0-9][0-9]*$//')"
  [ -n "$candidate" ] || return 0
  resolved="$(real_path "$candidate")"
  [ -n "$resolved" ] || return 0
  inside_root "$resolved" "$attachment_root" || return 0
  if [ -f "$resolved" ]; then file_bytes "$resolved" || true; fi
}

index=0
for input do
  resolved="$(real_path "$input")"
  if [ -z "$resolved" ] || ! [ -f "$resolved" ] && ! [ -d "$resolved" ]; then
    index=$((index + 1)); continue
  fi
  if ! inside_root "$resolved" "$sessions_root" && ! inside_root "$resolved" "$archived_root"; then
    index=$((index + 1)); continue
  fi
  total=0
  if [ -f "$resolved" ]; then
    own="$(file_bytes "$resolved" || true)"
    case "$own" in ''|*[!0-9]*) index=$((index + 1)); continue ;; esac
    total=$own
    # Attachment references are read only from this rollout. Shared attachments not referenced by
    # the thread are intentionally excluded, as are references that resolve outside CODEX_HOME.
    while IFS= read -r reference; do
      extra="$(attachment_bytes "$reference")"
      case "$extra" in ''|*[!0-9]*) ;; *) total=$((total + extra)) ;; esac
    done <<EOF
$(grep -aoE '/[^[:space:]" ]+/attachments/[^[:space:]" ]+' "$resolved" 2>/dev/null | sort -u || true)
EOF
  else
    total="$(directory_bytes "$resolved" || true)"
    case "$total" in ''|*[!0-9]*) index=$((index + 1)); continue ;; esac
  fi
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
