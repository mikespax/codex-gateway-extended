import { z } from "zod";

export interface CodexRemotePlatform {
  platform: "darwin" | "linux";
  arch: "arm64" | "x64";
  packageName:
    | "@openai/codex-darwin-arm64"
    | "@openai/codex-darwin-x64"
    | "@openai/codex-linux-arm64"
    | "@openai/codex-linux-x64";
  nodeTarget: "darwin-arm64" | "darwin-x64" | "linux-arm64" | "linux-x64";
}

const codexPlatformKeySchema = z.enum(["darwin:arm64", "darwin:x64", "linux:arm64", "linux:x64"]);

const PLATFORM_DETAILS = {
  "darwin:arm64": {
    platform: "darwin",
    arch: "arm64",
    packageName: "@openai/codex-darwin-arm64",
    nodeTarget: "darwin-arm64",
  },
  "darwin:x64": {
    platform: "darwin",
    arch: "x64",
    packageName: "@openai/codex-darwin-x64",
    nodeTarget: "darwin-x64",
  },
  "linux:arm64": {
    platform: "linux",
    arch: "arm64",
    packageName: "@openai/codex-linux-arm64",
    nodeTarget: "linux-arm64",
  },
  "linux:x64": {
    platform: "linux",
    arch: "x64",
    packageName: "@openai/codex-linux-x64",
    nodeTarget: "linux-x64",
  },
} as const satisfies Record<z.infer<typeof codexPlatformKeySchema>, CodexRemotePlatform>;

export function parseCodexRemotePlatform(output: string): CodexRemotePlatform {
  const [platform = "", arch = ""] = output.trim().split(/\s+/, 2);
  const result = codexPlatformKeySchema.safeParse(`${platform}:${arch}`);
  if (!result.success) {
    throw new Error(
      `Unsupported remote Codex platform: ${platform === "" ? "unknown" : platform}/${arch === "" ? "unknown" : arch}`,
    );
  }
  return PLATFORM_DETAILS[result.data];
}
