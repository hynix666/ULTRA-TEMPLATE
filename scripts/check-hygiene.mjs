/**
 * Repository hygiene: the SHAPE of the repository, which no test of its content can see.
 *
 * Each rule guards against a failure an ordinary build walks straight past — a .gitignore emptied by
 * an automated commit, thousands of dependency files tracked in a single change:
 *
 *   1. .gitignore still carries the rules whose absence is expensive, and has not been truncated.
 *   2. Nothing under a dependency directory is tracked, at any depth: every module has its own.
 *   3. No tracked file exceeds MAX_TRACKED_BYTES. Git keeps every blob forever.
 *   4. Every tracked .json parses. A truncated lockfile stops `npm ci` in CI, while `npm install`
 *      repairs it silently on every laptop.
 *   5. No tracked file is also ignored: it stays tracked today and cannot be re-added tomorrow.
 *   6. No environment file is tracked. Real credentials live outside the repository.
 *   7. Once template/ is gone, no template marker line survives.
 *   8. Workflows and local actions pin every third-party action to a full commit SHA; every
 *      workflow declares `permissions:` and every job a `timeout-minutes`; a step that starts a
 *      detached container removes it with a `trap` on exit, or on a reused self-hosted runner the
 *      container outlives the job and keeps its name and port from the next run. Every npm install in a
 *      workflow, local action or Dockerfile passes --ignore-scripts: a dependency's install script is
 *      how npm worms run code on the machine that installs them.
 *   9. Every job in verify.yml is listed under the aggregate `verify` job's `needs`. A job left out
 *      still runs and still shows red, but no longer blocks a merge — and nothing says so.
 *  10. No tracked source or config file contains a raw control character. A raw NUL makes git treat
 *      the whole file as binary: its diffs collapse to "Bin", so the change is never reviewed.
 *  11. No tracked source or config file contains an invisible or text-reordering character. A human
 *      reviewer sees nothing where an agent reads a hidden instruction, or code runs other than shown.
 *  12. No tracked source or config file holds an absolute path into someone's home directory.
 *  13. Every module present tracks the manifest and lockfile its toolchain installs from, and a
 *      Node module's manifest has the `verify` script both verify.mjs and its CI job run.
 *
 *   node scripts/check-hygiene.mjs
 *
 * Exit 0 clean · 1 a rule is broken · 2 the repository cannot be inspected.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { MODULES } from "./modules.mjs";

export const REQUIRED_IGNORES = ["node_modules/", "dist/", "coverage/", ".env", ".env.*"];
/** Below this the file was truncated, not edited. */
export const MIN_RULES = 10;
export const FORBIDDEN_TRACKED_DIRS = ["node_modules", ".venv", "venv", "__pycache__", ".mypy_cache", ".pytest_cache", ".ruff_cache"];
export const MAX_TRACKED_BYTES = 4 * 1024 * 1024;
/** Read by tools that accept comments; every other .json must be strict JSON. */
export const JSONC = /(^|\/)(tsconfig(\.[\w-]+)?\.json|devcontainer\.json)$|(^|\/)\.vscode\//;
export const MARKER = /ultra:(?:begin|end)\s+[a-z0-9-]+/;

const TEXT_SOURCE = /\.(mjs|cjs|js|jsx|ts|tsx|mts|go|py|toml|sh|ya?ml|json|md|c4|css|html)$/;
// Tab, LF and CR are the only C0 characters text needs; anything else belongs in an escape.
const CONTROL_CHAR = /[\x00-\x08\x0B\x0C\x0E-\x1F]/;
// Characters that render as nothing, or reorder what is shown, while a program — or an agent — still
// reads them: zero-width characters and invisible operators, bidirectional controls (Trojan Source),
// variation selectors, byte-order marks, invisible fillers, and the Unicode tag block, which carries
// whole hidden sentences ("ASCII smuggling"). Emoji are the exception: the presentation selector after a
// pictograph or keycap (as in a warning sign or a heart) and the joiner inside an emoji sequence are how
// ordinary emoji are spelt, so only a selector or joiner standing anywhere else is flagged.
// Written as escapes so this file contains none of them.
export const INVISIBLE_CHAR = /[\u200B\u200C\u2060-\u2064\u202A-\u202E\u2066-\u2069\uFE00-\uFE0D\uFEFF\u180E\u115F\u1160\u3164\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]|(?<![\p{Extended_Pictographic}0-9#*])[\uFE0E\uFE0F]|(?<![\p{Extended_Pictographic}\p{Emoji_Modifier}\uFE0F])\u200D|\u200D(?!\p{Extended_Pictographic})/u;
// An absolute path into one person's home directory on macOS or Windows: it names them, and works on no
// other machine. /home/<name> is not matched, because containers use it too (/home/node in a Dev Container
// mount, /home/app in a compose file), and there it is configuration, not someone's machine.
export const PERSONAL_PATH = /(?:^|[^\w.-])(?:\/Users\/|[A-Za-z]:[\\/]Users[\\/])[A-Za-z][\w.-]*/;
const ENV_FILE = /(^|\/)\.env(\.[^/]*)?$/;
const ENV_EXAMPLE = /(^|\/)\.env\.example$/;
const WORKFLOW = /^\.github\/(workflows\/[^/]+|actions\/.+\/action)\.ya?ml$/;
const USES = /^\s*(?:-\s*)?uses:\s*["']?([^\s"'#]+)/;
const PINNED = /^[^@\s]+@[0-9a-f]{40}$/;
const DETACHED = /\bdocker run\b(?=.*\s--detach\b)(?=.*\s--name[ =]([\w.-]+))/;
const NPM_INSTALL = /\bnpm\s+(?:ci|install|i)\b/;

/** Rule 8, installs: npm never runs a dependency's install scripts in CI or an image build. */
export function checkInstalls(path, text) {
  return text.split(/\r?\n/).flatMap((line, i) =>
    !/^\s*#/.test(line) && NPM_INSTALL.test(line) && !line.includes("--ignore-scripts")
      ? [`${path}:${i + 1} installs with npm without --ignore-scripts, so any dependency's install script runs.`]
      : []);
}

/**
 * What each toolchain installs from, and must therefore commit. Go has no entry: a module with
 * dependencies commits go.sum and one without does not, and `go mod tidy -diff` in verify holds both
 * to their go.mod.
 */
const MODULE_FILES = { node: ["package.json", "package-lock.json"], python: ["pyproject.toml", "uv.lock"], go: ["go.mod"] };

/**
 * Rule 13. A module whose lockfile is missing still installs — setup.mjs falls back to `npm install`,
 * which is how a new module's lockfile is first written — but from then on every machine and every CI
 * run resolves its own dependency tree, and nothing says so. This rule is what makes that fallback
 * safe to keep: the module cannot be committed without the lockfile the fallback produced.
 */
export function checkModules(tracked, read) {
  const failures = [];
  for (const module of MODULES) {
    if (!tracked.some((path) => path.startsWith(`${module.dir}/`))) continue;
    for (const file of MODULE_FILES[module.toolchain]) {
      if (!tracked.includes(`${module.dir}/${file}`)) {
        failures.push(`\`${module.dir}\` is present but does not track \`${file}\`, so it installs a dependency tree nothing pins.`);
      }
    }
    if (module.toolchain !== "node" || !tracked.includes(`${module.dir}/package.json`)) continue;
    let manifest;
    // Rule 4 reports a manifest that does not parse; this rule says nothing more about it.
    try {
      manifest = JSON.parse(read(`${module.dir}/package.json`));
    } catch {
      continue;
    }
    if (manifest.scripts?.verify === undefined) {
      failures.push(`\`${module.dir}/package.json\` has no \`verify\` script, which is the one entry point verify.mjs and its CI job run.`);
    }
  }
  return failures;
}

export const containsDir = (path, dir) => path === dir || path.startsWith(`${dir}/`) || path.includes(`/${dir}/`);
export const ignoreRules = (text) => text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "" && !l.startsWith("#"));

const git = (root, args, input) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8", input, maxBuffer: 64 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] });

function trackedAndIgnored(root, paths) {
  if (paths.length === 0) return [];
  try {
    // --no-index is load-bearing: without it git reports a tracked path as not ignored even when a
    // pattern matches it, which is exactly the case this rule exists to find.
    return git(root, ["check-ignore", "--no-index", "--stdin", "-z"], `${paths.join("\0")}\0`).split("\0").filter(Boolean);
  } catch (err) {
    if (err.status === 1) return []; // exit 1: no path matched, the clean case
    throw err;
  }
}

/** Rule 8 for one file. Reads the two-space layout this repository writes, not arbitrary YAML. */
export function checkWorkflow(path, text) {
  const problems = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    const ref = USES.exec(line)?.[1];
    if (ref === undefined || ref.startsWith("./") || ref.startsWith("docker://")) return;
    if (!PINNED.test(ref)) problems.push(`${path}:${i + 1} uses \`${ref}\`, which is not pinned to a 40-character commit SHA.`);
  });
  lines.forEach((line, i) => {
    const name = DETACHED.exec(line)?.[1];
    if (name === undefined) return;
    let step = i;
    while (step > 0 && !/^\s*- /.test(lines[step])) step--;
    const trapped = lines.slice(step, i).some((l) => /\btrap\b/.test(l) && l.includes(`docker rm --force ${name}`));
    if (!trapped) problems.push(`${path}:${i + 1} starts container \`${name}\` detached with no \`trap 'docker rm --force ${name}' EXIT\` before it.`);
  });
  problems.push(...checkInstalls(path, text));
  if (!path.includes("/workflows/")) return problems;

  if (!lines.some((l) => l.startsWith("permissions:"))) {
    problems.push(`${path} has no top-level \`permissions:\`, so every job gets the repository's default token scope.`);
  }
  const start = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  let job = null;
  const close = () => {
    if (job !== null && !job.timeout && !job.reusable) {
      problems.push(`${path}:${job.line} job \`${job.id}\` has no \`timeout-minutes\`; the default is six hours.`);
    }
  };
  for (let i = start + 1; start !== -1 && i < lines.length; i++) {
    const line = lines[i];
    if (/^[^\s#]/.test(line)) break;
    const opened = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (opened) {
      close();
      job = { id: opened[1], line: i + 1, timeout: false, reusable: false };
    } else if (job !== null) {
      if (/^ {4}timeout-minutes:/.test(line)) job.timeout = true;
      if (/^ {4}uses:/.test(line)) job.reusable = true;
    }
  }
  close();
  return problems;
}

/** Rule 9. Same layout assumption as checkWorkflow: jobs at two spaces, `needs` as a block list. */
export function checkGate(path, text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  const jobs = [];
  const needs = [];
  let inGate = false;
  let inNeeds = false;
  for (let i = start + 1; start !== -1 && i < lines.length; i++) {
    const line = lines[i];
    if (/^[^\s#]/.test(line)) break;
    const opened = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (opened) {
      jobs.push(opened[1]);
      inGate = opened[1] === "verify";
      inNeeds = false;
    } else if (inGate && /^ {4}needs:\s*$/.test(line)) {
      inNeeds = true;
    } else if (inGate && /^ {4}\S/.test(line)) {
      inNeeds = false;
    } else if (inNeeds) {
      const item = /^ {6}- ([A-Za-z0-9_-]+)\s*$/.exec(line);
      if (item) needs.push(item[1]);
    }
  }
  if (!jobs.includes("verify")) return [`${path} has no aggregate \`verify\` job, which branch protection requires.`];
  const outside = jobs.filter((job) => job !== "verify" && !needs.includes(job));
  return outside.length === 0
    ? []
    : [`${path}: job(s) ${outside.join(", ")} are missing from \`verify.needs\`, so they run but do not gate a merge.`];
}

export function checkRepoHygiene(root = process.cwd()) {
  if (!existsSync(join(root, ".gitignore"))) return { ok: false, fatal: ".gitignore is missing. Restore it from the last good revision." };
  let tracked;
  try {
    tracked = git(root, ["ls-files", "-z"]).split("\0").filter(Boolean);
  } catch (err) {
    return { ok: false, fatal: `cannot list tracked files; is this a git repository? ${String(err.message).split("\n")[0]}` };
  }
  if (tracked.length === 0) {
    return { ok: false, fatal: "nothing is tracked yet, so every rule would pass without checking anything. Run `git add -A` first." };
  }
  const read = (path) => readFileSync(join(root, path), "utf8");
  const present = tracked.filter((p) => existsSync(join(root, p)));
  const failures = [];

  const rules = ignoreRules(read(".gitignore"));
  for (const rule of REQUIRED_IGNORES) {
    if (!rules.includes(rule)) failures.push(`.gitignore no longer carries \`${rule}\`. Removing it is a decision, not a cleanup.`);
  }
  if (rules.length < MIN_RULES) {
    failures.push(`.gitignore holds ${rules.length} rule(s), below the floor of ${MIN_RULES}: it was truncated, not edited.`);
  }

  for (const dir of FORBIDDEN_TRACKED_DIRS) {
    const hits = tracked.filter((p) => containsDir(p, dir));
    if (hits.length > 0) failures.push(`${hits.length} tracked file(s) under a \`${dir}\` directory, e.g. ${hits[0]}. Untrack with \`git rm -r --cached\`.`);
  }

  for (const path of present) {
    const bytes = statSync(join(root, path)).size;
    if (bytes > MAX_TRACKED_BYTES) {
      failures.push(`\`${path}\` is ${(bytes / 1048576).toFixed(1)} MB, over the ${MAX_TRACKED_BYTES / 1048576} MB bound. Git keeps the blob even after a later commit removes it.`);
    }
  }

  for (const path of present.filter((p) => p.endsWith(".json") && !JSONC.test(p))) {
    try {
      JSON.parse(read(path));
    } catch (err) {
      failures.push(`\`${path}\` is not valid JSON: ${err.message}`);
    }
  }

  const ignored = trackedAndIgnored(root, tracked);
  if (ignored.length > 0) {
    failures.push(`${ignored.length} tracked file(s) are also ignored, e.g. ${ignored[0]}. Narrow the rule, or anchor it with a leading slash.`);
  }

  const envFiles = tracked.filter((p) => ENV_FILE.test(p) && !ENV_EXAMPLE.test(p));
  if (envFiles.length > 0) {
    failures.push(`environment file(s) tracked: ${envFiles.join(", ")}. Revoke any secret they held, then untrack them.`);
  }

  if (!existsSync(join(root, "template"))) {
    const leftovers = [];
    for (const path of present) {
      const bytes = readFileSync(join(root, path));
      if (bytes.includes(0)) continue;
      const line = bytes.toString("utf8").split("\n").findIndex((l) => MARKER.test(l));
      if (line !== -1) leftovers.push(`${path}:${line + 1}`);
    }
    if (leftovers.length > 0) failures.push(`template marker line(s) survived initialization: ${leftovers.join(", ")}.`);
  }

  for (const path of present.filter((p) => WORKFLOW.test(p))) failures.push(...checkWorkflow(path, read(path)));
  for (const path of present.filter((p) => /(^|\/)Dockerfile$/.test(p))) failures.push(...checkInstalls(path, read(path)));
  failures.push(...checkModules(tracked, read));

  const gate = ".github/workflows/verify.yml";
  if (present.includes(gate)) failures.push(...checkGate(gate, read(gate)));

  const withControl = [];
  for (const path of present.filter((p) => TEXT_SOURCE.test(p))) {
    const line = read(path).split("\n").findIndex((l) => CONTROL_CHAR.test(l));
    if (line !== -1) withControl.push(`${path}:${line + 1}`);
  }
  if (withControl.length > 0) {
    failures.push(`raw control character(s) in ${withControl.join(", ")}. Write them as escapes such as \\u0000: the value is the same, and the file stays text to git, grep and review.`);
  }

  const withInvisible = [];
  const withHomePath = [];
  for (const path of present.filter((p) => TEXT_SOURCE.test(p))) {
    const lines = read(path).split("\n");
    const invisible = lines.findIndex((l) => INVISIBLE_CHAR.test(l));
    if (invisible !== -1) withInvisible.push(`${path}:${invisible + 1}`);
    const home = lines.findIndex((l) => PERSONAL_PATH.test(l));
    if (home !== -1) withHomePath.push(`${path}:${home + 1}`);
  }
  if (withInvisible.length > 0) {
    failures.push(`invisible or text-reordering character(s) in ${withInvisible.join(", ")}. A reviewer cannot see them and an agent still reads them; delete them, or write them as escapes where one is really meant.`);
  }
  if (withHomePath.length > 0) {
    failures.push(`absolute path(s) into a home directory in ${withHomePath.join(", ")}. Use a path relative to the repository, or a placeholder such as \`~\` or \`<you>\`.`);
  }

  return { ok: failures.length === 0, failures, trackedCount: tracked.length, ruleCount: rules.length };
}

function main() {
  const result = checkRepoHygiene(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
  if (result.fatal) {
    console.error(`check-hygiene: ${result.fatal}`);
    return 2;
  }
  if (!result.ok) {
    console.error(`check-hygiene: ${result.failures.length} problem(s)\n`);
    for (const failure of result.failures) console.error(`  ${failure}\n`);
    return 1;
  }
  console.log(`check-hygiene: OK. ${result.ruleCount} ignore rules, ${result.trackedCount} tracked files.`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
