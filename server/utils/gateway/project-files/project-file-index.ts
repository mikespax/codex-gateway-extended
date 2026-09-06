import { posix } from "node:path";
import Fuse from "fuse.js";
import type { FileReference, HostRecord, ProjectRecord } from "~~/shared/types";
import { sshConnections } from "../infra/host-services";
import { remoteLoginShellCommand } from "../infra/ssh/remote-command";
import { shellQuote } from "../infra/ssh/shell";
import { hostRuntimeFingerprint } from "../runtime/host-runtime-fingerprint";
import { currentGatewayUserId } from "../state/memory";
import { normalizeReferencePath } from "./project-file-references";

const INDEX_TTL_MS = 30_000;
const MAX_INDEX_FILES = 50_000;
const MAX_RESULTS = 50;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const EXCLUDED_SEGMENTS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  "coverage",
  "__pycache__",
  "vendor",
  "venv",
  ".venv",
]);

interface CachedIndex {
  expiresAt: number;
  files: FileReference[];
}

export type ProjectFileIndexCacheState = "built" | "shared" | "cached";

export interface ProjectFileSearchResult {
  files: FileReference[];
  cacheState: ProjectFileIndexCacheState;
}

class ProjectFileIndexService {
  private readonly cache = new Map<string, CachedIndex>();
  private readonly pending = new Map<string, Promise<FileReference[]>>();

  async search(
    host: HostRecord,
    project: ProjectRecord,
    query: string,
  ): Promise<ProjectFileSearchResult> {
    if (project.hostId !== host.id) {
      throw new Error(`Project ${project.id} does not belong to host ${host.id}`);
    }
    const { files, cacheState } = await this.getIndex(host, project);
    const normalizedQuery = query.trim();
    if (normalizedQuery === "") {
      return {
        files: [...files]
          .sort(
            (left, right) =>
              pathDepth(left.path) - pathDepth(right.path) || left.path.localeCompare(right.path),
          )
          .slice(0, MAX_RESULTS),
        cacheState,
      };
    }

    const needle = normalizedQuery.toLocaleLowerCase();
    const fuse = new Fuse(files, {
      keys: [
        { name: "name", weight: 0.65 },
        { name: "path", weight: 0.35 },
      ],
      threshold: 0.42,
      includeScore: true,
      ignoreLocation: true,
    });
    return {
      files: fuse
        .search(normalizedQuery, { limit: MAX_RESULTS })
        .sort((left, right) => {
          const leftPriority = matchPriority(left.item, needle);
          const rightPriority = matchPriority(right.item, needle);
          return (
            leftPriority - rightPriority ||
            (left.score ?? 1) - (right.score ?? 1) ||
            left.item.path.localeCompare(right.item.path)
          );
        })
        .map((result) => result.item),
      cacheState,
    };
  }

  private async getIndex(host: HostRecord, project: ProjectRecord) {
    const key = `${currentGatewayUserId() ?? "anonymous"}:${host.id}:${hostRuntimeFingerprint(host)}:${project.id}:${project.remotePath}`;
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return { files: cached.files, cacheState: "cached" as const };
    }
    const existing = this.pending.get(key);
    if (existing) {
      return { files: await existing, cacheState: "shared" as const };
    }

    const request = this.buildIndex(host, project).then((files) => {
      this.cache.set(key, { files, expiresAt: Date.now() + INDEX_TTL_MS });
      return files;
    });
    this.pending.set(key, request);
    try {
      return { files: await request, cacheState: "built" as const };
    } finally {
      if (this.pending.get(key) === request) this.pending.delete(key);
    }
  }

  private async buildIndex(host: HostRecord, project: ProjectRecord) {
    const result = await sshConnections.runBackground(host, () =>
      sshConnections.exec(host, remoteLoginShellCommand(indexPayload(project.remotePath)), {
        timeoutMs: 45_000,
        maxOutputBytes: MAX_OUTPUT_BYTES,
      }),
    );
    if (result.code !== 0) {
      throw new Error(
        result.stderr.trim() || result.stdout.trim() || "Failed to build project file index",
      );
    }
    const unique = new Map<string, FileReference>();
    for (const rawPath of result.stdout.split("\0")) {
      if (rawPath === "" || unique.size >= MAX_INDEX_FILES) continue;
      try {
        const path = normalizeReferencePath(rawPath);
        if (path.split("/").some((part) => EXCLUDED_SEGMENTS.has(part))) continue;
        unique.set(path, { type: "file", path, name: posix.basename(path) });
      } catch {
        // Ignore malformed tool output; paths are validated again before every turn.
      }
    }
    return [...unique.values()];
  }
}

function indexPayload(root: string) {
  const directory = shellQuote(root);
  return `
set -eu
cd ${directory}
if command -v git >/dev/null 2>&1 && git -c safe.directory="$PWD" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git -c safe.directory="$PWD" ls-files -z --cached --others --exclude-standard
elif command -v rg >/dev/null 2>&1; then
  rg --files -0 --hidden \\
    -g '!.git/**' -g '!node_modules/**' -g '!dist/**' -g '!build/**' \\
    -g '!.next/**' -g '!coverage/**' -g '!__pycache__/**' -g '!vendor/**' \\
    -g '!venv/**' -g '!.venv/**'
elif command -v find >/dev/null 2>&1; then
  # File mentions are a baseline remote-files feature, so they cannot require
  # optional developer tools. Keep git and rg as the fast paths, then use the
  # standard remote filesystem walker for plain directories and minimal hosts.
  find . \\
    \\( -type d \\( \\
      -name .git -o -name node_modules -o -name dist -o -name build -o \\
      -name .next -o -name coverage -o -name __pycache__ -o -name vendor -o \\
      -name venv -o -name .venv \\
    \\) -prune \\) -o \\
    -type f -exec printf '%s\\0' {} +
else
  echo 'Project file search requires a usable find command on the remote host' >&2
  exit 127
fi
`;
}

function pathDepth(path: string) {
  return path.split("/").length;
}

function matchPriority(reference: FileReference, query: string) {
  const name = reference.name.toLocaleLowerCase();
  const stem = name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : name;
  if (name === query || stem === query) return 0;
  if (name.startsWith(query)) return 1;
  if (reference.path.toLocaleLowerCase().startsWith(query)) return 2;
  return 3;
}

export const projectFileIndex = new ProjectFileIndexService();
