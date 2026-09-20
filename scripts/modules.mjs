/**
 * The modules a checkout can contain, and the one place that knows how to run a command for them.
 *
 * Presence is read from the filesystem, never from configuration: a module exists when its
 * directory does. Deleting the directory removes it from setup and verify with nothing else to
 * edit, and no file can claim a module that is not there.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const MODULES = [
  { id: "go-service", dir: "services/api-go", toolchain: "go" },
  { id: "ts-service", dir: "services/api-ts", toolchain: "node" },
  { id: "mcp-server", dir: "services/mcp-server", toolchain: "node" },
  { id: "py-service", dir: "services/api-py", toolchain: "python" },
  { id: "web", dir: "apps/web", toolchain: "node" },
  { id: "ts-library", dir: "packages/ts-library", toolchain: "node" },
  { id: "architecture", dir: "architecture", toolchain: "node" },
];

export const presentModules = (root = ROOT) => MODULES.filter((m) => existsSync(join(root, m.dir)));

/**
 * Runs a command and returns its exit status, and its stdout when `capture` is set.
 *
 * On Windows `npm` is a .cmd shim that only a shell can start, so commands go through one there,
 * joined into a single string: every argument this repository passes is a plain token, which is
 * what makes that safe.
 */
export function run(command, args, { cwd = ROOT, capture = false } = {}) {
  const stdio = capture ? ["ignore", "pipe", "inherit"] : "inherit";
  const result = process.platform === "win32"
    ? spawnSync([command, ...args].join(" "), { cwd, stdio, shell: true, encoding: "utf8" })
    : spawnSync(command, args, { cwd, stdio, encoding: "utf8" });
  if (result.error) return { status: 127, stdout: "" };
  return { status: result.status ?? 1, stdout: result.stdout ?? "" };
}

export const available = (command, args = ["version"]) => run(command, args, { capture: true }).status === 0;
