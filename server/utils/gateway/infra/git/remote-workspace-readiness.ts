import { randomUUID } from "node:crypto";
import { posix } from "node:path";
import { remoteLoginShellCommand } from "../ssh/remote-command";
import { shellQuote } from "../ssh/shell";
import type { SshConnectionPool } from "../ssh/ssh-connection";
import type { HostWithSecret } from "../ssh/ssh-types";

const READINESS_TIMEOUT_MS = 30_000;
const PREPARE_TIMEOUT_MS = 5 * 60_000;
const MAX_READINESS_OUTPUT_BYTES = 16 * 1024;
const VPS_HOST_NAME = "vps";
const VPS_OPERATIONS_WORKSPACE = "/root/stickerlight-ops";
const VPS_GENERIC_WORKSPACE_PATHS = new Set([
  "/",
  "/root",
  "/root/.aws",
  "/root/.cache",
  "/root/.codex",
  "/root/.config",
  "/tmp",
  "/var/tmp",
]);
const VPS_EPHEMERAL_WORKSPACE_ROOTS = ["/tmp", "/var/tmp"] as const;

export function isVpsGenericWorkspacePath(path: string) {
  const normalizedPath = posix.normalize(path.trim());
  return (
    VPS_GENERIC_WORKSPACE_PATHS.has(normalizedPath) ||
    VPS_EPHEMERAL_WORKSPACE_ROOTS.some((root) => normalizedPath.startsWith(`${root}/`))
  );
}

export type SourceWorkspaceKind = "thread_cwd" | "project_cwd" | "operations_fallback";

export type WorkspacePreparationFailure =
  | "source_workspace_missing"
  | "source_not_git"
  | "source_dirty"
  | "source_origin_missing"
  | "source_commit_missing"
  | "target_exists"
  | "target_unavailable"
  | "verification_failed";

export class WorkspacePreparationError extends Error {
  constructor(
    readonly reason: WorkspacePreparationFailure,
    message = "Failed to prepare remote workspace",
  ) {
    super(message);
    this.name = "WorkspacePreparationError";
  }
}

export type RemoteWorkspaceReadiness =
  | {
      availability: "missing" | "notGit";
      repositoryRoot: null;
      repositoryIdentity: null;
      headCommit: null;
      clean: false;
      originConfigured: false;
    }
  | {
      availability: "available";
      repositoryRoot: string;
      // This is a one-way fingerprint of the origin URL. The URL itself never leaves the remote
      // shell and is never logged or included in the public DTO.
      repositoryIdentity: string | null;
      headCommit: string | null;
      clean: boolean;
      originConfigured: boolean;
    };

export interface PreparedWorkspace {
  source: RemoteWorkspaceReadiness;
  target: RemoteWorkspaceReadiness;
  sourceWorkspaceKind: SourceWorkspaceKind;
  sourceWorkspaceCwd: string;
}

export interface ResolvedSourceWorkspace {
  readiness: RemoteWorkspaceReadiness;
  kind: SourceWorkspaceKind;
  cwd: string;
}

export class RemoteWorkspaceReadinessService {
  constructor(private readonly ssh: Pick<SshConnectionPool, "exec">) {}

  async inspect(host: HostWithSecret, path: string): Promise<RemoteWorkspaceReadiness> {
    const signal = AbortSignal.timeout(READINESS_TIMEOUT_MS);
    const result = await this.ssh.exec(
      host,
      remoteLoginShellCommand(workspaceReadinessCommand(path)),
      {
        timeoutMs: READINESS_TIMEOUT_MS,
        signal,
        maxOutputBytes: MAX_READINESS_OUTPUT_BYTES,
      },
    );
    if (result.code !== 0) {
      throw new Error("Failed to inspect remote workspace readiness");
    }
    return parseReadiness(result.stdout);
  }

  async pathExists(host: HostWithSecret, path: string): Promise<boolean> {
    const signal = AbortSignal.timeout(READINESS_TIMEOUT_MS);
    const result = await this.ssh.exec(host, remoteLoginShellCommand(pathExistsCommand(path)), {
      timeoutMs: READINESS_TIMEOUT_MS,
      signal,
      maxOutputBytes: MAX_READINESS_OUTPUT_BYTES,
    });
    if (result.code !== 0) throw new Error("Failed to inspect remote workspace path");
    const value = result.stdout.trim();
    if (value === "present") return true;
    if (value === "missing") return false;
    throw new Error("Remote workspace path inspection returned an invalid result");
  }

  async resolveSourceWorkspace(
    host: HostWithSecret,
    sourceCwd: string,
    projectCwd?: string | null,
  ): Promise<ResolvedSourceWorkspace> {
    const normalizedSourceCwd = posix.normalize(sourceCwd.trim());
    const source = await this.inspect(host, normalizedSourceCwd);
    if (source.availability === "available") {
      return { readiness: source, kind: "thread_cwd", cwd: normalizedSourceCwd };
    }

    const trimmedProjectCwd = projectCwd?.trim() ?? "";
    const normalizedProjectCwd =
      trimmedProjectCwd === "" ? null : posix.normalize(trimmedProjectCwd);
    if (
      normalizedProjectCwd !== null &&
      normalizedProjectCwd !== normalizedSourceCwd &&
      isAncestorPath(normalizedProjectCwd, normalizedSourceCwd)
    ) {
      const project = await this.inspect(host, normalizedProjectCwd);
      if (project.availability === "available") {
        return { readiness: project, kind: "project_cwd", cwd: normalizedProjectCwd };
      }
    }

    if (
      isVpsGenericWorkspacePath(normalizedSourceCwd) &&
      host.name.trim().toLowerCase() === VPS_HOST_NAME
    ) {
      const fallback = await this.inspect(host, VPS_OPERATIONS_WORKSPACE);
      if (fallback.availability === "available") {
        return {
          readiness: fallback,
          kind: "operations_fallback",
          cwd: VPS_OPERATIONS_WORKSPACE,
        };
      }
    }

    return { readiness: source, kind: "thread_cwd", cwd: normalizedSourceCwd };
  }

  async prepare(
    sourceHost: HostWithSecret,
    sourceCwd: string,
    sourceProjectCwd: string | null | undefined,
    targetHost: HostWithSecret,
    targetCwd: string,
  ): Promise<PreparedWorkspace> {
    const targetPath = posix.normalize(targetCwd.trim());
    const resolvedSource = await this.resolveSourceWorkspace(
      sourceHost,
      sourceCwd,
      sourceProjectCwd,
    );
    const source = resolvedSource.readiness;
    if (source.availability === "missing") {
      throw new WorkspacePreparationError(
        "source_workspace_missing",
        "The source thread working directory is missing",
      );
    }
    if (source.availability === "notGit") {
      throw new WorkspacePreparationError(
        "source_not_git",
        "The source thread working directory is not a Git repository",
      );
    }
    if (!source.clean) {
      throw new WorkspacePreparationError(
        "source_dirty",
        "The source Git repository has tracked or untracked changes; preparation requires a clean source",
      );
    }
    if (!source.originConfigured) {
      throw new WorkspacePreparationError(
        "source_origin_missing",
        "The source Git repository has no origin remote",
      );
    }
    if (source.headCommit === null) {
      throw new WorkspacePreparationError(
        "source_commit_missing",
        "The source Git repository has no resolved HEAD commit",
      );
    }
    if (await this.pathExists(targetHost, targetPath)) {
      throw new WorkspacePreparationError(
        "target_exists",
        "The target working directory already exists and will not be overwritten",
      );
    }

    const originUrl = await this.readOriginUrl(sourceHost, resolvedSource.cwd);
    const stagingPath = `${targetPath}.codex-gateway-staging-${randomUUID()}`;
    const result = await this.ssh.exec(
      targetHost,
      prepareWorkspaceCommand(originUrl, source.headCommit, targetPath, stagingPath),
      {
        timeoutMs: PREPARE_TIMEOUT_MS,
        signal: AbortSignal.timeout(PREPARE_TIMEOUT_MS),
        maxOutputBytes: MAX_READINESS_OUTPUT_BYTES,
      },
    );
    if (result.code !== 0) {
      if (result.code === 42) {
        throw new WorkspacePreparationError(
          "target_exists",
          "The target working directory appeared during preparation and was not overwritten",
        );
      }
      throw new WorkspacePreparationError(
        "target_unavailable",
        "The target Git workspace could not be cloned; no existing target was overwritten",
      );
    }

    const target = await this.inspect(targetHost, targetPath);
    if (
      target.availability !== "available" ||
      target.repositoryIdentity === null ||
      source.repositoryIdentity === null ||
      target.repositoryIdentity !== source.repositoryIdentity ||
      target.headCommit !== source.headCommit ||
      !target.clean
    ) {
      throw new WorkspacePreparationError(
        "verification_failed",
        "The prepared target workspace failed final Git verification",
      );
    }
    return {
      source,
      target,
      sourceWorkspaceKind: resolvedSource.kind,
      sourceWorkspaceCwd: resolvedSource.cwd,
    };
  }

  private async readOriginUrl(host: HostWithSecret, path: string) {
    const signal = AbortSignal.timeout(READINESS_TIMEOUT_MS);
    const result = await this.ssh.exec(host, remoteOriginUrlCommand(path), {
      timeoutMs: READINESS_TIMEOUT_MS,
      signal,
      maxOutputBytes: MAX_READINESS_OUTPUT_BYTES,
    });
    const originUrl = result.stdout.trim();
    if (result.code !== 0 || originUrl === "") {
      throw new WorkspacePreparationError(
        "source_origin_missing",
        "The source Git repository origin could not be read",
      );
    }
    return originUrl;
  }

  async containsCommit(
    host: HostWithSecret,
    repositoryRoot: string,
    commit: string,
  ): Promise<boolean> {
    if (!/^[0-9a-f]{40,64}$/.test(commit)) {
      throw new Error("Remote workspace inspection returned an invalid source commit");
    }
    const signal = AbortSignal.timeout(READINESS_TIMEOUT_MS);
    const result = await this.ssh.exec(
      host,
      remoteLoginShellCommand(commitPresenceCommand(repositoryRoot, commit)),
      {
        timeoutMs: READINESS_TIMEOUT_MS,
        signal,
        maxOutputBytes: MAX_READINESS_OUTPUT_BYTES,
      },
    );
    if (result.code !== 0) {
      throw new Error("Failed to verify source commit on target workspace");
    }
    const value = result.stdout.trim();
    if (value === "present") return true;
    if (value === "missing") return false;
    throw new Error("Remote workspace commit inspection returned an invalid result");
  }
}

function workspaceReadinessCommand(path: string) {
  const script = `
set -eu
workspace_path=$1
if [ ! -d "$workspace_path" ]; then
  printf 'missing\\0'
  exit 0
fi
if ! command -v git >/dev/null 2>&1; then
  printf 'notGit\\0'
  exit 0
fi
physical_path=$(cd -- "$workspace_path" 2>/dev/null && pwd -P) || {
  printf 'missing\\0'
  exit 0
}
repo_root=$(GIT_OPTIONAL_LOCKS=0 git --no-optional-locks -C "$physical_path" rev-parse --show-toplevel 2>/dev/null || true)
if [ -z "$repo_root" ]; then
  printf 'notGit\\0'
  exit 0
fi
repo_root=$(cd -- "$repo_root" && pwd -P)
head_commit=$(GIT_OPTIONAL_LOCKS=0 git --no-optional-locks -C "$repo_root" rev-parse --verify HEAD 2>/dev/null || true)
origin_url=$(GIT_OPTIONAL_LOCKS=0 git --no-optional-locks -C "$repo_root" config --get remote.origin.url 2>/dev/null || true)
repository_identity=
if [ -n "$origin_url" ]; then
  if command -v sha256sum >/dev/null 2>&1; then
    repository_identity=$(printf '%s\\n' "$origin_url" | sha256sum | awk '{print $1}')
  elif command -v shasum >/dev/null 2>&1; then
    repository_identity=$(printf '%s\\n' "$origin_url" | shasum -a 256 | awk '{print $1}')
  fi
fi
GIT_OPTIONAL_LOCKS=0 git --no-optional-locks -C "$repo_root" status --porcelain=v2 --untracked-files=all >/dev/null
clean=1
if ! GIT_OPTIONAL_LOCKS=0 git --no-optional-locks -C "$repo_root" diff --quiet --no-ext-diff; then clean=0; fi
if ! GIT_OPTIONAL_LOCKS=0 git --no-optional-locks -C "$repo_root" diff --cached --quiet --no-ext-diff; then clean=0; fi
if [ -n "$(GIT_OPTIONAL_LOCKS=0 git --no-optional-locks -C "$repo_root" ls-files --others --exclude-standard | sed -n '1p')" ]; then clean=0; fi
origin_configured=0
if [ -n "$origin_url" ]; then origin_configured=1; fi
printf 'available\\0%s\\0%s\\0%s\\0%s\\0%s\\0' "$repo_root" "$repository_identity" "$head_commit" "$clean" "$origin_configured"
`;
  return remoteLoginShellCommand(`sh -c ${shellQuote(script)} sh ${shellQuote(path.trim())}`);
}

function pathExistsCommand(path: string) {
  const script = `
set -eu
if [ -e "$1" ] || [ -L "$1" ]; then
  printf 'present\\n'
else
  printf 'missing\\n'
fi
`;
  return remoteLoginShellCommand(`sh -c ${shellQuote(script)} sh ${shellQuote(path.trim())}`);
}

function remoteOriginUrlCommand(path: string) {
  const script = `
set -eu
workspace_path=$1
physical_path=$(cd -- "$workspace_path" 2>/dev/null && pwd -P)
repo_root=$(GIT_OPTIONAL_LOCKS=0 git --no-optional-locks -C "$physical_path" rev-parse --show-toplevel 2>/dev/null)
repo_root=$(cd -- "$repo_root" && pwd -P)
origin_url=$(GIT_OPTIONAL_LOCKS=0 git --no-optional-locks -C "$repo_root" config --get remote.origin.url 2>/dev/null || true)
[ -n "$origin_url" ]
printf '%s\\n' "$origin_url"
`;
  return remoteLoginShellCommand(`sh -c ${shellQuote(script)} sh ${shellQuote(path.trim())}`);
}

function prepareWorkspaceCommand(
  originUrl: string,
  commit: string,
  targetPath: string,
  stagingPath: string,
) {
  const script = `
set -eu
origin_url=$1
source_commit=$2
target_path=$3
staging_path=$4
if [ -e "$target_path" ] || [ -L "$target_path" ]; then exit 42; fi
parent_path=$(dirname -- "$target_path")
mkdir -p -- "$parent_path"
if [ -e "$target_path" ] || [ -L "$target_path" ]; then exit 42; fi
if [ -e "$staging_path" ] || [ -L "$staging_path" ]; then exit 43; fi
cleanup() { rm -rf -- "$staging_path"; }
trap cleanup EXIT HUP INT TERM
git clone --no-checkout --origin origin -- "$origin_url" "$staging_path" >/dev/null 2>&1
git -C "$staging_path" checkout --detach "$source_commit" >/dev/null 2>&1
if ! mv -T -n -- "$staging_path" "$target_path" >/dev/null 2>&1; then
  if [ -e "$target_path" ] || [ -L "$target_path" ]; then exit 42; fi
  exit 44
fi
if [ -e "$staging_path" ] || [ -L "$staging_path" ]; then
  if [ -e "$target_path" ] || [ -L "$target_path" ]; then exit 42; fi
  exit 44
fi
trap - EXIT HUP INT TERM
printf 'installed\\n'
`;
  return remoteLoginShellCommand(
    `sh -c ${shellQuote(script)} sh ${shellQuote(originUrl)} ${shellQuote(commit)} ${shellQuote(targetPath.trim())} ${shellQuote(stagingPath.trim())}`,
  );
}

function commitPresenceCommand(repositoryRoot: string, commit: string) {
  const script = `
set -eu
repo_root=$1
commit=$2
if GIT_OPTIONAL_LOCKS=0 git --no-optional-locks -C "$repo_root" cat-file -e "$commit^{commit}" 2>/dev/null; then
  printf 'present\\n'
  exit 0
fi
exit_code=$?
if [ "$exit_code" -eq 1 ]; then
  printf 'missing\\n'
  exit 0
fi
exit "$exit_code"
`;
  return remoteLoginShellCommand(
    `sh -c ${shellQuote(script)} sh ${shellQuote(repositoryRoot)} ${shellQuote(commit)}`,
  );
}

function parseReadiness(output: string): RemoteWorkspaceReadiness {
  const fields = output.split("\0");
  const availability = fields[0];
  if (availability === "missing" || availability === "notGit") {
    return {
      availability,
      repositoryRoot: null,
      repositoryIdentity: null,
      headCommit: null,
      clean: false,
      originConfigured: false,
    };
  }
  if (availability !== "available") {
    throw new Error("Remote workspace inspection returned an invalid capability state");
  }
  const repositoryRoot = fields[1];
  const repositoryIdentity = fields[2];
  const rawHeadCommit = fields[3];
  const rawClean = fields[4];
  const rawOriginConfigured = fields[5];
  if (repositoryRoot === undefined || repositoryRoot === "") {
    throw new Error("Remote workspace inspection omitted the repository root");
  }
  if (
    repositoryIdentity === undefined ||
    rawHeadCommit === undefined ||
    rawClean === undefined ||
    rawOriginConfigured === undefined
  ) {
    throw new Error("Remote workspace inspection omitted repository metadata");
  }
  return {
    availability,
    repositoryRoot,
    repositoryIdentity: repositoryIdentity === "" ? null : repositoryIdentity,
    headCommit: rawHeadCommit === "" ? null : rawHeadCommit,
    clean: rawClean === "1",
    originConfigured: rawOriginConfigured === "1",
  };
}

function isAncestorPath(parent: string, child: string) {
  const normalizedParent = posix.normalize(parent);
  const normalizedChild = posix.normalize(child);
  return normalizedParent !== "/" && normalizedChild.startsWith(`${normalizedParent}/`);
}
