/**
 * Brings the changes between two template releases into a project made from the template.
 *
 * A generated project keeps none of the template's history, so a later fix cannot be merged the usual
 * way. It keeps enough to recompute it, though: CHANGELOG.md records the template release it came from
 * and the features selected, and the project's name, owner and repository are its identity. So this
 * generates the project twice — as release A's init would have made it, and as release B's would — and
 * applies the difference with a three-way merge. Only what the template changed between A and B reaches
 * the project, already renamed and without the features it did not select. What the project changed
 * itself is kept; where both changed the same lines, the conflict is left in the working tree like any
 * merge conflict, for a person to resolve.
 *
 *   node scripts/template-update.mjs --to vX.Y.Z              # apply, then review with git diff
 *   node scripts/template-update.mjs --to vX.Y.Z --dry-run    # list what would change
 *
 * Needs git, network access to the template repository, and a clean working tree. Owner and repository
 * are read from the `origin` remote; --owner and --repo override them, and --template points at another
 * copy of the template (a path or URL).
 *
 * Exit 0 applied cleanly or nothing to do · 1 applied with conflicts · 2 cannot run.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

export class UpdateError extends Error {}

const VERSION = /^v\d+\.\d+\.\d+$/;
// Written by init, and by this script.
const ORIGIN = /^- (Initialized from|Updated to) \[[^\]\s]+ (v\d+\.\d+\.\d+)\]\((https:\/\/github\.com\/[^/]+\/[^/]+)\/releases\/tag\/v\d+\.\d+\.\d+\)(?: with (.+?))?\.?$/gm;

/** What the project's CHANGELOG says about where it came from. */
export function readOrigin(changelog) {
  const lines = [...changelog.matchAll(ORIGIN)];
  const initialized = lines.find((m) => m[1] === "Initialized from");
  if (!initialized) throw new UpdateError('CHANGELOG.md has no "Initialized from" line, so the template release this project came from is unknown.');
  // Updates only move forward, so the newest release is the highest version. Position proves nothing:
  // new lines go under the heading, above older ones, and release-please moves sections around.
  const current = lines.reduce((best, line) => (compareVersions(line[2], best[2]) > 0 ? line : best));
  const features = initialized[4] === "no features" ? [] : initialized[4].split(",").map((f) => f.trim());
  return { version: current[2], url: current[3], features };
}

export function compareVersions(a, b) {
  const [x, y] = [a, b].map((v) => v.slice(1).split(".").map(Number));
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/** Records the update beside the line init wrote, so the next update knows where to start. */
export function recordUpdate(changelog, url, to) {
  const heading = "## [Unreleased]";
  const repo = url.split("/").at(-1);
  const line = `- Updated to [${repo} ${to}](${url}/releases/tag/${to}).`;
  if (!changelog.includes(heading)) return `${changelog.trimEnd()}\n\n${heading}\n\n${line}\n`;
  return changelog.replace(heading, `${heading}\n\n${line}`);
}

/** Owner and repository from a GitHub remote URL, or null. */
export function remoteIdentity(url) {
  const match = /github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url.trim());
  return match ? { owner: match[1], repo: match[2] } : null;
}

const git = (cwd, args, options = {}) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options });
/** The line of an error worth showing: git's own message where there is one, not the command it ran. */
const firstLine = (err) => String(err?.stderr || err?.message || err).trim().split("\n")[0];

/** Runs a template release's own init, exactly as a new project would have. */
function generate(templateDir, identity, features, out) {
  const selection = features.length === 0 ? ["--preset", "minimal"] : ["--features", features.join(",")];
  const args = ["template/init.mjs", "--name", identity.name, "--owner", identity.owner, "--repo", identity.repo, ...selection, "--out", out];
  const result = spawnSync(process.execPath, args, { cwd: templateDir, encoding: "utf8" });
  if (result.status !== 0) throw new UpdateError(`init at ${templateDir} failed: ${(result.stderr || result.stdout).trim().split("\n").at(-1)}`);
}

/** Replaces a repository's tracked content with a directory's, as one commit. */
function commitTree(repo, from, message) {
  for (const entry of readdirSync(repo)) if (entry !== ".git") rmSync(join(repo, entry), { recursive: true, force: true });
  cpSync(from, repo, { recursive: true });
  git(repo, ["add", "-A"]);
  git(repo, ["-c", "user.name=template-update", "-c", "user.email=template-update@localhost", "commit", "-q", "--allow-empty", "-m", message]);
  return git(repo, ["rev-parse", "HEAD"]).trim();
}

export function update({ project, to, dryRun = false, template, owner, repo, log = console.log }) {
  if (!VERSION.test(to ?? "")) throw new UpdateError(`--to must be a release tag such as v1.10.0, got "${to ?? ""}".`);
  if (git(project, ["status", "--porcelain"]).trim() !== "") throw new UpdateError("The working tree has uncommitted changes. Commit or stash them first, so the update can be reviewed and undone on its own.");

  const changelogPath = join(project, "CHANGELOG.md");
  if (!existsSync(changelogPath)) throw new UpdateError("CHANGELOG.md is missing; it records which template release this project came from.");
  const changelog = readFileSync(changelogPath, "utf8");
  const origin = readOrigin(changelog);
  if (origin.version === to) {
    log(`template-update: already at ${to}.`);
    return { status: "current" };
  }
  // Applied backwards, the difference would quietly undo later releases, and the recorded version (the
  // highest one listed) would still claim the newer release. Updates only move forward.
  if (compareVersions(to, origin.version) < 0) {
    throw new UpdateError(`${to} is older than ${origin.version}, the release this project is on. template-update only moves forward.`);
  }

  const packageJson = join(project, "package.json");
  const name = existsSync(packageJson) ? JSON.parse(readFileSync(packageJson, "utf8")).name : undefined;
  let fromRemote = null;
  try {
    fromRemote = remoteIdentity(git(project, ["remote", "get-url", "origin"]));
  } catch {
    // No origin remote; --owner and --repo must say it.
  }
  const identity = { name, owner: owner ?? fromRemote?.owner, repo: repo ?? fromRemote?.repo };
  if (!identity.name || !identity.owner || !identity.repo) {
    throw new UpdateError("Cannot tell this project's name, owner and repository. The name comes from package.json; pass --owner and --repo when there is no GitHub origin remote.");
  }

  const work = mkdtempSync(join(tmpdir(), "template-update-"));
  try {
    const source = template ?? `${origin.url}.git`;
    log(`template-update: ${origin.version} → ${to} from ${source}, features: ${origin.features.join(", ") || "none"}`);
    try {
      git(work, ["clone", "--quiet", "--no-checkout", source, "template"]);
    } catch (err) {
      throw new UpdateError(`cannot fetch the template from ${source}: ${firstLine(err)}`);
    }
    const clone = join(work, "template");
    for (const version of [origin.version, to]) {
      try {
        git(clone, ["rev-parse", "--verify", "--quiet", `refs/tags/${version}^{commit}`]);
      } catch {
        throw new UpdateError(`There is no release ${version} in ${source}.`);
      }
    }
    const pair = join(work, "pair");
    mkdirSync(pair);
    git(pair, ["init", "-q"]);
    const shas = [];
    for (const version of [origin.version, to]) {
      const tree = join(work, `at-${version}`);
      git(clone, ["worktree", "add", "--quiet", "--detach", tree, version]);
      generate(tree, identity, origin.features, join(work, `gen-${version}`));
      shas.push(commitTree(pair, join(work, `gen-${version}`), `template ${version}`));
    }
    const [before, after] = shas;
    // The CHANGELOG is the project's own; init's origin line in it is replaced by the "Updated to" line.
    let scope = ["--", ".", ":(exclude)CHANGELOG.md"];
    const entries = git(pair, ["diff", "--no-renames", "--name-status", before, after, ...scope]).trim().split("\n").filter(Boolean);
    // A change to a file the project has since deleted is the project's decision standing; skip it
    // rather than let one missing file make git apply refuse the whole patch.
    // Each line is "<status>\t<path>"; a path may itself contain a tab, so split at the first one only.
    const parsed = entries.map((e) => [e.slice(0, e.indexOf("\t")), e.slice(e.indexOf("\t") + 1)]);
    const skipped = parsed.filter(([kind, path]) => kind !== "A" && !existsSync(join(project, path))).map(([, path]) => path);
    scope = [...scope, ...skipped.map((path) => `:(exclude)${path}`)];
    const files = parsed.filter(([, path]) => !skipped.includes(path)).map(([kind, path]) => `${kind} ${path}`);
    if (skipped.length > 0) log(`template-update: skipped ${skipped.length} file(s) this project removed: ${skipped.join(", ")}`);
    if (files.length === 0) {
      log(`template-update: nothing in ${to} changes a file this project has.`);
      if (!dryRun) writeFileSync(changelogPath, recordUpdate(changelog, origin.url, to));
      return { status: dryRun ? "dry-run" : "applied", conflicts: [], changed: [], skipped };
    }
    if (dryRun) {
      log(`template-update: ${files.length} file(s) would change:\n  ${files.join("\n  ")}`);
      return { status: "dry-run", changed: files };
    }

    // The objects must be in the project for a three-way merge to find each file's common ancestor.
    git(project, ["fetch", "--quiet", "--no-tags", pair, `+HEAD:refs/template-update/after`]);
    const patch = git(pair, ["diff", "--no-renames", "--binary", "--full-index", before, after, ...scope]);
    const applied = spawnSync("git", ["apply", "--3way", "--whitespace=nowarn"], { cwd: project, input: patch, encoding: "utf8" });
    git(project, ["update-ref", "-d", "refs/template-update/after"]);
    const conflicts = git(project, ["diff", "--name-only", "--diff-filter=U"]).trim().split("\n").filter(Boolean);
    if (applied.status !== 0 && conflicts.length === 0) {
      throw new UpdateError(`git apply could not use the patch: ${applied.stderr.trim().split("\n").at(-1)}`);
    }
    writeFileSync(changelogPath, recordUpdate(changelog, origin.url, to));
    log(`template-update: ${files.length} file(s) changed.${conflicts.length ? ` Resolve ${conflicts.length} conflict(s): ${conflicts.join(", ")}` : ""}`);
    log("Next: git diff to review, node scripts/setup.mjs, node scripts/verify.mjs, then commit.");
    return { status: "applied", conflicts, changed: files, skipped };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function main() {
  const { values } = parseArgs({
    options: { to: { type: "string" }, "dry-run": { type: "boolean" }, template: { type: "string" }, owner: { type: "string" }, repo: { type: "string" } },
  });
  try {
    const result = update({ project: process.cwd(), to: values.to, dryRun: values["dry-run"], template: values.template, owner: values.owner, repo: values.repo });
    return result.conflicts?.length ? 1 : 0;
  } catch (err) {
    // Exit 1 means "applied with conflicts", so anything that stops the update before that is 2.
    console.error(`template-update: ${err instanceof UpdateError ? err.message : `could not run: ${firstLine(err)}`}`);
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
