import { basename, isAbsolute, relative } from "pathe";
import { parse } from "shell-quote";

const DISPLAY_SHELLS = new Set(["bash", "sh", "zsh"]);
const SHELL_EXEC_FLAGS = new Set(["-c", "-lc"]);

export function commandDisplayLabel(command: string | null | undefined) {
  const rawCommand = command?.trim() ?? "";
  if (rawCommand === "") return "Command";

  try {
    const argv = parse(rawCommand);
    if (argv.length !== 3) {
      return rawCommand;
    }
    const [shell, flag, script] = argv;
    if (typeof shell !== "string" || typeof flag !== "string" || typeof script !== "string") {
      return rawCommand;
    }
    const shellName = basename(shell)
      .replace(/\.exe$/i, "")
      .toLowerCase();
    // App-server serializes argv with shell quoting. Match the official TUI by unwrapping only
    // the exact shell -c/-lc shape; looser text matching can remove a real command argument.
    return DISPLAY_SHELLS.has(shellName) && SHELL_EXEC_FLAGS.has(flag) ? script : rawCommand;
  } catch {
    return rawCommand;
  }
}

export function workspacePathDisplayLabel(path: string, workspaceRoot: string | null | undefined) {
  if (workspaceRoot === null || workspaceRoot === undefined || workspaceRoot === "") return path;
  if (!isAbsolute(path) || !isAbsolute(workspaceRoot)) return path;

  const workspaceRelativePath = relative(workspaceRoot, path);
  if (
    workspaceRelativePath === "" ||
    workspaceRelativePath === ".." ||
    workspaceRelativePath.startsWith("../") ||
    isAbsolute(workspaceRelativePath)
  ) {
    return path;
  }
  // Only paths proven to be inside this thread's cwd are shortened. File operations continue to
  // use the original path, and outside-workspace paths remain absolute instead of showing ../.
  return workspaceRelativePath;
}
