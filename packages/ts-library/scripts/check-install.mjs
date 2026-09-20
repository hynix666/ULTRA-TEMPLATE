// Installs the packed package into an empty project, as a consumer would, and imports it by name.
// publint and are-the-types-wrong read the package's metadata and types; this runs it, so a package
// that installs but does not load fails here rather than after publishing.
//
// Exit 0 the installed package exports what dist/index.js exports · 1 it does not, or cannot load.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
// Run through `npm run`, npm names its own CLI in npm_execpath; calling it with this Node needs no
// shell, which Windows would otherwise require to start npm.cmd.
const cli = process.env.npm_execpath;
const npm = (args, cwd) =>
  execFileSync(cli ? process.execPath : "npm", cli ? [cli, ...args] : args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const { name } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const consumer = mkdtempSync(join(tmpdir(), "consumer-"));
try {
  // `npm pack` runs prepack, so the tarball holds a fresh build. npm 11 prints an object keyed by
  // package name, older versions an array; either way there is one entry.
  const packed = JSON.parse(npm(["pack", "--json", "--pack-destination", consumer], root));
  const { filename } = Array.isArray(packed) ? packed[0] : Object.values(packed)[0];
  writeFileSync(join(consumer, "package.json"), JSON.stringify({ name: "consumer", private: true, type: "module" }));
  npm(["install", "--ignore-scripts", "--no-audit", "--no-fund", join(consumer, filename)], consumer);
  writeFileSync(join(consumer, "index.mjs"), `export * from ${JSON.stringify(name)};\n`);

  const installed = Object.keys(await import(pathToFileURL(join(consumer, "index.mjs")).href)).sort();
  const built = Object.keys(await import(pathToFileURL(join(root, "dist", "index.js")).href)).sort();
  if (installed.length === 0 || installed.join() !== built.join()) {
    console.error(`check-install: ${name} installed with exports [${installed.join(", ")}], expected [${built.join(", ")}].`);
    process.exitCode = 1;
  } else {
    console.log(`check-install: ${name} installs and imports by name, with ${installed.length} export(s).`);
  }
} finally {
  rmSync(consumer, { recursive: true, force: true });
}
