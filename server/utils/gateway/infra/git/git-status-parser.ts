import type { RemoteGitFileStatus, RemoteGitWorkspaceFile } from "~~/shared/types";

export interface ParsedGitStatusRecord extends RemoteGitWorkspaceFile {}

/** Parse `git status --porcelain=v2 -z` without splitting paths on whitespace.
 *
 * Porcelain v2 gives each ordinary record a fixed number of metadata fields. Rename/copy records
 * additionally put the original path in the following NUL record. Keeping this parser at the SSH
 * boundary gives single-file comparison and workspace review one interpretation of Git state; UI
 * code must never infer status from labels or run one Git command per tree row.
 */
export function parseGitStatusRecords(records: string[]): ParsedGitStatusRecord[] {
  const parsed: ParsedGitStatusRecord[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record === undefined || record === "") continue;
    if (record.startsWith("? ")) {
      const relativePath = record.slice(2);
      // Even with `--untracked-files=all`, Git reports an embedded repository as one directory
      // entry. The file review protocol intentionally models files only; exposing that directory as
      // a file would make the tree attempt an invalid read and compare it against the outer repo.
      if (!relativePath.endsWith("/")) {
        parsed.push(change(relativePath, null, "untracked", false, true));
      }
      continue;
    }
    if (record.startsWith("! ")) continue;

    const kind = record[0];
    const fields = fixedFields(record, kind === "2" ? 10 : kind === "u" ? 11 : 9);
    const xy = fields[1];
    const relativePath = fields.at(-1);
    if (xy === undefined || relativePath === undefined || relativePath === "") {
      throw new Error("Remote Git status returned an incomplete porcelain v2 record");
    }
    const staged = xy[0] !== ".";
    const unstaged = xy[1] !== ".";
    if (kind === "u") {
      parsed.push(change(relativePath, null, "conflicted", staged, unstaged));
      continue;
    }
    if (kind === "2") {
      const originalPath = records[index + 1];
      if (originalPath === undefined || originalPath === "") {
        throw new Error("Remote Git rename record omitted its original path");
      }
      index += 1;
      parsed.push(
        change(
          relativePath,
          originalPath,
          xy.includes("R") ? "renamed" : "copied",
          staged,
          unstaged,
        ),
      );
      continue;
    }
    if (kind !== "1") throw new Error("Remote Git status returned an unsupported record");
    parsed.push(change(relativePath, null, statusFromXY(xy), staged, unstaged));
  }
  return parsed;
}

function fixedFields(record: string, count: number) {
  const fields: string[] = [];
  let offset = 0;
  for (let index = 0; index < count - 1; index += 1) {
    const separator = record.indexOf(" ", offset);
    if (separator < 0) throw new Error("Remote Git status returned malformed porcelain v2 data");
    fields.push(record.slice(offset, separator));
    offset = separator + 1;
  }
  fields.push(record.slice(offset));
  return fields;
}

function statusFromXY(xy: string): "modified" | "added" | "deleted" {
  if (xy.includes("D")) return "deleted";
  if (xy.includes("A")) return "added";
  return "modified";
}

function change(
  relativePath: string,
  originalPath: string | null,
  status: Exclude<RemoteGitFileStatus, "clean" | "ignored">,
  staged: boolean,
  unstaged: boolean,
): ParsedGitStatusRecord {
  return { relativePath, originalPath, status, staged, unstaged };
}
