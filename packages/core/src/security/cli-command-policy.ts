import { basename } from "node:path";
import { ArenaClientError } from "../errors.js";

/** Well-known coding-agent CLIs that may be launched as `cli_pty` employees by bare name. */
export const DEFAULT_CLI_ALLOWLIST: readonly string[] = [
  "claude",
  "codex",
  "aider",
  "gemini",
  "opencode",
  "goose",
  "cursor-agent",
  "qwen",
];

/** Extra allowed binaries for this hub host: bare names or absolute paths, separated by `,` or `;`. */
export const CLI_ALLOWLIST_ENV = "FACTORY_ARENA_CLI_ALLOWLIST";

/** Shells are never allowed: any argument list turns them into arbitrary command execution. */
const SHELLS = new Set([
  "sh",
  "bash",
  "zsh",
  "fish",
  "dash",
  "ksh",
  "csh",
  "tcsh",
  "cmd",
  "powershell",
  "pwsh",
  "wsl",
  "env",
  "xargs",
]);

/** Interpreters that may be allowlisted explicitly, but never with inline-code flags. */
const INTERPRETERS = new Set(["node", "deno", "bun", "python", "python3", "ruby", "perl", "php"]);
const INLINE_CODE_FLAGS = new Set([
  "-e",
  "--eval",
  "-p",
  "--print",
  "-c",
  "-r",
  "--require",
  "--import",
  "--loader",
  "--experimental-loader",
]);

const MAX_ARGS = 64;
const MAX_ARG_LENGTH = 4096;

function normalizeBinaryName(bin: string): string {
  return basename(bin)
    .toLowerCase()
    .replace(/\.(exe|cmd|bat|ps1)$/, "");
}

function hasPathSeparator(value: string): boolean {
  return value.includes("/") || value.includes("\\");
}

export function readCliAllowlist(env: NodeJS.ProcessEnv = process.env): string[] {
  const extra = (env[CLI_ALLOWLIST_ENV] ?? "")
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
  return [...DEFAULT_CLI_ALLOWLIST, ...extra];
}

/**
 * Validates a `cli_command` before it is stored or spawned.
 * - bare names must be on the allowlist (resolved through PATH by the OS);
 * - paths must match an allowlisted absolute path exactly (no basename spoofing);
 * - shells are always refused; interpreters are refused with inline-code flags.
 * Throws {@link ArenaClientError} (400/403) when the command is not acceptable.
 */
export function assertAllowedCliCommand(
  command: readonly string[],
  allowlist: readonly string[] = readCliAllowlist(),
): void {
  const [bin, ...args] = command;
  if (!bin || bin.trim() === "") {
    throw new ArenaClientError("cli_command must start with a binary name", 400);
  }
  if (args.length > MAX_ARGS || command.some((part) => part.length > MAX_ARG_LENGTH)) {
    throw new ArenaClientError("cli_command is too long", 400);
  }
  if (command.some((part) => part.includes("\0"))) {
    throw new ArenaClientError("cli_command must not contain NUL bytes", 400);
  }

  const name = normalizeBinaryName(bin);
  if (SHELLS.has(name)) {
    throw new ArenaClientError(`cli_command may not launch a shell (${name})`, 403);
  }

  const allowed = hasPathSeparator(bin)
    ? allowlist.some((entry) => hasPathSeparator(entry) && entry === bin)
    : allowlist.some((entry) => !hasPathSeparator(entry) && normalizeBinaryName(entry) === name);
  if (!allowed) {
    throw new ArenaClientError(
      `cli_command binary "${bin}" is not allowlisted. Add it to ${CLI_ALLOWLIST_ENV} on the hub host to permit it.`,
      403,
    );
  }

  if (INTERPRETERS.has(name)) {
    const inline = args.find((arg) => INLINE_CODE_FLAGS.has(arg.split("=")[0] ?? arg));
    if (inline) {
      throw new ArenaClientError(
        `cli_command may not pass inline code to ${name} (${inline})`,
        403,
      );
    }
  }
}
