/**
 * Installs the dependencies of every module present: `npm ci` where a lockfile exists (the exact
 * tree CI installs), `npm install` where one does not yet, `go mod download` for Go, and
 * `uv sync --locked` for Python — each the command that installs exactly what the lockfile says, and
 * refuses when the lockfile no longer matches its manifest. (`uv sync --frozen` does not refuse.)
 *
 * npm installs run with --ignore-scripts: no dependency's install script runs on this machine, which
 * is how npm worms spread. The flag covers installation only; `npm run` and `npm pack` behave as usual.
 *
 * Exit 0 all installed · 1 an install failed.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { presentModules, ROOT, run } from "./modules.mjs";

let failed = 0;
for (const module of presentModules()) {
  const cwd = join(ROOT, module.dir);
  const [command, args] = module.toolchain === "go"
    ? ["go", ["mod", "download"]]
    : module.toolchain === "python"
    ? ["uv", existsSync(join(cwd, "uv.lock")) ? ["sync", "--locked"] : ["sync"]]
    : ["npm", [existsSync(join(cwd, "package-lock.json")) ? "ci" : "install", "--ignore-scripts"]];
  console.log(`\n▶ ${module.id}: ${command} ${args.join(" ")}`);
  const { status } = run(command, args, { cwd });
  if (status !== 0) {
    failed++;
    // 127 is what run() returns when the command could not start at all: name the missing tool,
    // or the only clue is a red line that says nothing about why.
    const why = status === 127 ? ` ${command} is not on PATH; install it or remove the module.` : "";
    console.error(`setup: ${module.id} failed to install.${why}`);
  }
}
if (failed === 0) console.log("\nsetup: OK — next, node scripts/verify.mjs");
process.exitCode = failed === 0 ? 0 : 1;
