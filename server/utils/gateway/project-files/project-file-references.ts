import { posix } from "node:path";
import type { SFTPWrapper, Stats } from "ssh2";
import type { FileReference, HostRecord, ProjectRecord } from "~~/shared/types";
import { sshConnections } from "../infra/host-services";

export const MAX_FILE_REFERENCES = 10;

export async function validateProjectFileReferences(
  host: HostRecord,
  project: ProjectRecord,
  references: FileReference[],
): Promise<FileReference[]> {
  if (project.hostId !== host.id) {
    throw new Error(`Project ${project.id} does not belong to host ${host.id}`);
  }
  if (references.length > MAX_FILE_REFERENCES) {
    throw new Error(`A turn can reference at most ${MAX_FILE_REFERENCES} project files`);
  }

  const normalized = [
    ...new Map(
      references.map((reference) => {
        const path = normalizeReferencePath(reference.path);
        return [path, { type: "file" as const, path, name: posix.basename(path) }];
      }),
    ).values(),
  ];
  const sftp = await sshConnections.sftp(host);
  const root = await realpath(sftp, project.remotePath);

  await Promise.all(
    normalized.map(async (reference) => {
      const candidate = await realpath(sftp, posix.join(root, reference.path));
      if (!isWithinRoot(root, candidate)) {
        throw new Error(`Referenced file escapes the project root: ${reference.path}`);
      }
      const stats = await stat(sftp, candidate);
      if (!stats.isFile()) {
        throw new Error(`Referenced path is not a regular file: ${reference.path}`);
      }
    }),
  );
  return normalized;
}

export function normalizeReferencePath(value: string) {
  if (value === "" || value.startsWith("/") || value.includes("\\") || hasControlCharacter(value)) {
    throw new Error("File references must use a non-empty relative POSIX path");
  }
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    throw new Error("File reference contains invalid percent encoding");
  }
  if (decoded.startsWith("/") || decoded.includes("\\") || decoded.split("/").includes("..")) {
    throw new Error("File reference contains an encoded or literal path traversal");
  }
  const path = posix.normalize(value.replace(/^\.\//u, ""));
  if (path === "." || path === ".." || path.startsWith("../") || path.split("/").includes("..")) {
    throw new Error("File reference must stay within the project root");
  }
  return path;
}

function hasControlCharacter(value: string) {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function isWithinRoot(root: string, candidate: string) {
  const normalizedRoot = root === "/" ? root : root.replace(/\/+$/u, "");
  return (
    normalizedRoot === "/" ||
    candidate === normalizedRoot ||
    candidate.startsWith(`${normalizedRoot}/`)
  );
}

function realpath(sftp: SFTPWrapper, path: string) {
  return new Promise<string>((resolve, reject) => {
    sftp.realpath(path, (error, resolved) => (error ? reject(error) : resolve(resolved)));
  });
}

function stat(sftp: SFTPWrapper, path: string) {
  return new Promise<Stats>((resolve, reject) => {
    sftp.stat(path, (error, stats) => (error ? reject(error) : resolve(stats)));
  });
}

export function fileReferencesAdditionalContext(
  references: FileReference[],
): Record<string, { value: string; kind: "untrusted" | "application" }> {
  if (references.length === 0) return {};
  return {
    "gateway:file-references": {
      value: JSON.stringify({ version: 1, references }),
      kind: "untrusted" as const,
    },
  };
}
