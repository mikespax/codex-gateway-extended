import type { RemoteGitFileStatus } from "~~/shared/types";

export function gitStatusCode(status: RemoteGitFileStatus) {
  switch (status) {
    case "modified":
      return "M";
    case "added":
      return "A";
    case "deleted":
      return "D";
    case "renamed":
      return "R";
    case "copied":
      return "C";
    case "untracked":
      return "U";
    case "conflicted":
      return "!";
    case "clean":
    case "ignored":
      return "";
  }
}

export function gitStatusTextClass(status: RemoteGitFileStatus) {
  switch (status) {
    case "added":
    case "untracked":
      return "text-accent-green";
    case "deleted":
    case "conflicted":
      return "text-destructive";
    case "renamed":
    case "copied":
      return "text-primary";
    case "modified":
      return "text-accent-orange";
    case "clean":
    case "ignored":
      return "text-ink-muted";
  }
}
