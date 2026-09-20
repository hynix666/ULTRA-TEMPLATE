// scripts/template-update.mjs, run against a real release history: this tree as one release, the
// same tree with a change as the next, and a project generated from the first. Template-only, because
// generating needs the template, which init deletes from every project.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { compareVersions, readOrigin, recordUpdate, remoteIdentity, update, UpdateError } from "../scripts/template-update.mjs";
import { loadManifest, ROOT } from "./init.mjs";

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const commit = (cwd, message) => git(cwd, "-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-q", "-am", message);
const quiet = () => {};

const { version } = loadManifest();
const FROM = `v${version}`;
const [major, minor] = version.split(".").map(Number);
const TO = `v${major}.${minor + 1}.0`;
const NOTE = "Security fixes are released for the latest minor version only.";

let work;
let template;

before(() => {
  work = mkdtempSync(join(tmpdir(), "tu-"));
  template = join(work, "template");
  for (const file of git(ROOT, "ls-files", "-z").split("\0").filter(Boolean)) {
    if (!existsSync(join(ROOT, file))) continue;
    mkdirSync(dirname(join(template, file)), { recursive: true });
    copyFileSync(join(ROOT, file), join(template, file));
  }
  git(template, "init", "-q");
  git(template, "config", "core.autocrlf", "false");
  git(template, "add", "-A");
  commit(template, "release");
  git(template, "tag", FROM);
  // The next release changes one chassis file and bumps the version, as a real release does.
  const security = join(template, "SECURITY.md");
  writeFileSync(security, readFileSync(security, "utf8").replace("## Reporting a vulnerability", `${NOTE}\n\n## Reporting a vulnerability`));
  const manifest = join(template, "template/features.json");
  writeFileSync(manifest, readFileSync(manifest, "utf8").replace(`"version": "${version}"`, `"version": "${TO.slice(1)}"`));
  commit(template, "next release");
  git(template, "tag", TO);
});

after(() => rmSync(work, { recursive: true, force: true }));

/** A project made from the first release, committed, as a team would have it. */
function project(name) {
  const dir = join(work, name);
  execFileSync(process.execPath, ["template/init.mjs", "--name", "demo-app", "--owner", "octo-org", "--preset", "minimal", "--out", dir], {
    cwd: join(work, "template"),
    stdio: "ignore",
  });
  git(dir, "init", "-q");
  git(dir, "config", "core.autocrlf", "false");
  git(dir, "add", "-A");
  commit(dir, "chore: initialize project");
  return dir;
}

const run = (dir, options = {}) => update({ project: dir, to: TO, template, owner: "octo-org", repo: "demo-app", log: quiet, ...options });

test("a template change reaches the project, and the project's own changes stay", () => {
  git(template, "checkout", "-q", FROM);
  const dir = project("clean");
  git(template, "checkout", "-q", "-");
  const readme = join(dir, "README.md");
  writeFileSync(readme, `${readFileSync(readme, "utf8")}\nOur own section.\n`);
  commit(dir, "docs: our section");

  const result = run(dir);

  assert.deepEqual(result.conflicts, []);
  assert.match(readFileSync(join(dir, "SECURITY.md"), "utf8"), new RegExp(NOTE));
  assert.match(readFileSync(readme, "utf8"), /Our own section\./);
  // Renamed as the project is named, never as the template: the identity came through init.
  assert.doesNotMatch(readFileSync(join(dir, "SECURITY.md"), "utf8"), /hynix666\/ULTRA-TEMPLATE/);
  const changelog = readFileSync(join(dir, "CHANGELOG.md"), "utf8");
  assert.match(changelog, new RegExp(`Updated to \\[ULTRA-TEMPLATE ${TO.replaceAll(".", "\\.")}\\]`));
  assert.equal(readOrigin(changelog).version, TO, "the next update starts from here");
});

test("where the project changed the same lines, the conflict is left to resolve", () => {
  git(template, "checkout", "-q", FROM);
  const dir = project("conflict");
  git(template, "checkout", "-q", "-");
  const security = join(dir, "SECURITY.md");
  writeFileSync(security, readFileSync(security, "utf8").replace("## Reporting a vulnerability", "Our own policy line.\n\n## Reporting a vulnerability"));
  commit(dir, "docs: our policy");

  const result = run(dir);

  assert.deepEqual(result.conflicts, ["SECURITY.md"]);
  assert.match(readFileSync(security, "utf8"), /<<<<<<< /);
});

test("a dry run changes nothing, and an update already made is not made twice", () => {
  git(template, "checkout", "-q", FROM);
  const dir = project("dry");
  git(template, "checkout", "-q", "-");

  const dry = run(dir, { dryRun: true });
  assert.equal(dry.status, "dry-run");
  assert.ok(dry.changed.some((line) => line.endsWith("SECURITY.md")), dry.changed.join());
  assert.equal(git(dir, "status", "--porcelain"), "");

  run(dir);
  commit(dir, "chore: update the template");
  assert.equal(run(dir).status, "current");
});

test("a change to a file the project deleted is skipped, not forced back", () => {
  git(template, "checkout", "-q", FROM);
  const dir = project("deleted");
  git(template, "checkout", "-q", "-");
  git(dir, "rm", "-q", "SECURITY.md");
  commit(dir, "chore: our policy lives elsewhere");

  const result = run(dir);

  assert.deepEqual(result.skipped, ["SECURITY.md"]);
  assert.equal(existsSync(join(dir, "SECURITY.md")), false);
});

test("it refuses to go back to an older release, and changes nothing", () => {
  const dir = project("downgrade");
  const before = git(dir, "rev-parse", "HEAD");
  assert.throws(() => run(dir, { to: FROM }), /older than/);
  assert.equal(git(dir, "status", "--porcelain"), "");
  assert.equal(git(dir, "rev-parse", "HEAD"), before);
});

test("a release that does not exist is named as such, and changes nothing", () => {
  const dir = project("no-such-release");
  const before = git(dir, "rev-parse", "HEAD");
  assert.throws(() => run(dir, { to: "v9.9.9" }), (err) => err instanceof UpdateError && /no release v9\.9\.9/.test(err.message));
  assert.equal(git(dir, "status", "--porcelain"), "");
  assert.equal(git(dir, "rev-parse", "HEAD"), before);
});

test("a template it cannot reach exits 2, could not run, never 1, which means conflicts", () => {
  git(template, "checkout", "-q", FROM);
  const dir = project("unreachable");
  git(template, "checkout", "-q", "-");
  const result = spawnSync(
    process.execPath,
    [join(ROOT, "scripts/template-update.mjs"), "--to", TO, "--template", join(work, "no-such-template"), "--owner", "octo-org", "--repo", "demo-app"],
    { cwd: dir, encoding: "utf8" },
  );
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /^template-update: /m);
  assert.doesNotMatch(result.stderr, /\n\s+at /);
});

test("it refuses to start without what it needs", () => {
  git(template, "checkout", "-q", FROM);
  const dir = project("refusals");
  git(template, "checkout", "-q", "-");
  assert.throws(() => run(dir, { to: "latest" }), UpdateError);
  writeFileSync(join(dir, "README.md"), "uncommitted\n");
  assert.throws(() => run(dir), /uncommitted changes/);
});

test("the origin line is read whichever release wrote it, and the highest version wins", () => {
  const changelog = [
    "## [Unreleased]",
    "",
    "- Updated to [ULTRA-TEMPLATE v1.4.0](https://github.com/hynix666/ULTRA-TEMPLATE/releases/tag/v1.4.0).",
    "- Initialized from [ULTRA-TEMPLATE v1.2.0](https://github.com/hynix666/ULTRA-TEMPLATE/releases/tag/v1.2.0) with go-service, release.",
  ].join("\n");
  // The newer line sits above the older one; the highest version wins, not the last line.
  const origin = readOrigin(changelog);
  assert.equal(origin.version, "v1.4.0");
  assert.deepEqual(origin.features, ["go-service", "release"]);
  assert.equal(compareVersions("v1.10.0", "v1.9.9") > 0, true, "numeric, not lexical");
  assert.equal(readOrigin(recordUpdate("## [Unreleased]\n\n- Initialized from [ULTRA-TEMPLATE v1.3.1](https://github.com/hynix666/ULTRA-TEMPLATE/releases/tag/v1.3.1) with no features.\n", "https://github.com/hynix666/ULTRA-TEMPLATE", "v1.4.0")).version, "v1.4.0");
  assert.deepEqual(remoteIdentity("git@github.com:octo-org/demo-app.git"), { owner: "octo-org", repo: "demo-app" });
  assert.equal(remoteIdentity("https://gitlab.com/octo-org/demo-app"), null);
});
