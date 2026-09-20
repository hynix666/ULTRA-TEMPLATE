// Every rule gets a case that must fire and the clean fixture that must not. A checker with only
// the passing case proves nothing: it passes just as well when the rule is broken.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { checkGate, checkModules, checkRepoHygiene, checkWorkflow, MAX_TRACKED_BYTES, REQUIRED_IGNORES } from "../scripts/check-hygiene.mjs";

const IGNORE = [...REQUIRED_IGNORES, "!.env.example", "build/", "*.tsbuildinfo", ".DS_Store", ".idea/", "*.local"].join("\n");
const SHA = "3d3c42e5aac5ba805825da76410c181273ba90b1";

function fixture(t, files) {
  const root = mkdtempSync(join(tmpdir(), "hygiene-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [path, content] of Object.entries({ ".gitignore": `${IGNORE}\n`, ...files })) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  execFileSync("git", ["init", "-q"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["add", "-A", "--force"], { cwd: root, stdio: "ignore" });
  return root;
}

const failures = (root) => checkRepoHygiene(root).failures.join("\n");

test("a clean repository passes", (t) => {
  const result = checkRepoHygiene(fixture(t, { "README.md": "# ok\n", "package.json": "{}\n", ".env.example": "PORT=8080\n" }));
  assert.equal(result.ok, true, result.failures?.join("\n"));
});

test("a truncated .gitignore fails", (t) => {
  assert.match(failures(fixture(t, { ".gitignore": "node_modules/\n" })), /below the floor/);
});

test("a dependency directory tracked below the root fails", (t) => {
  assert.match(failures(fixture(t, { "apps/web/node_modules/pkg/index.js": "" })), /under a `node_modules` directory/);
});

test("a build cache tracked anywhere fails, whatever produced it", (t) => {
  // Committed once by a Python module whose .gitignore had no rules for it; a rule, not an incident.
  assert.match(failures(fixture(t, { "services/api-py/src/__pycache__/x.pyc": "" })), /under a `__pycache__` directory/);
  assert.match(failures(fixture(t, { ".pytest_cache/v/cache/lastfailed": "{}" })), /under a `.pytest_cache` directory/);
});

test("an oversized file fails", (t) => {
  assert.match(failures(fixture(t, { "blob.bin": Buffer.alloc(MAX_TRACKED_BYTES + 1) })), /blob\.bin` is 4\.0 MB/);
});

test("invalid JSON fails while tsconfig comments pass", (t) => {
  const found = failures(fixture(t, { "broken.json": "{", "tsconfig.json": "{ // comments are fine here\n}\n" }));
  assert.match(found, /broken\.json` is not valid JSON/);
  assert.doesNotMatch(found, /tsconfig/);
});

test("a tracked .env fails and .env.example does not", (t) => {
  const found = failures(fixture(t, { ".env": "TOKEN=x\n", ".env.example": "TOKEN=\n" }));
  assert.match(found, /environment file\(s\) tracked: \.env\./);
  assert.doesNotMatch(found, /tracked: .*\.env\.example/);
});

test("a template marker fails after initialization but not while template/ exists", (t) => {
  const marker = `# ultra:${"begin"} web\n`;
  assert.match(failures(fixture(t, { "ci.yml": marker })), /survived initialization: ci\.yml:1/);
  assert.equal(checkRepoHygiene(fixture(t, { "ci.yml": marker, "template/features.json": "{}\n" })).ok, true);
});

test("workflow rules fire on an unpinned action, missing permissions and a missing timeout", () => {
  const found = checkWorkflow(".github/workflows/ci.yml", "on: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v7\n").join("\n");
  assert.match(found, /not pinned/);
  assert.match(found, /no top-level `permissions:`/);
  assert.match(found, /job `build` has no `timeout-minutes`/);
});

test("a pinned workflow with permissions and timeouts passes, and a reusable call needs no timeout", () => {
  const text = [
    "on: push", "permissions:", "  contents: read", "jobs:",
    "  build:", "    runs-on: ubuntu-latest", "    timeout-minutes: 5", "    steps:",
    `      - uses: actions/checkout@${SHA} # v7.0.1`, "      - uses: ./.github/actions/local",
    "  deploy:", "    uses: ./.github/workflows/deploy.yml",
  ].join("\n");
  assert.deepEqual(checkWorkflow(".github/workflows/ci.yml", text), []);
});

test("a step that starts a detached container must remove it with a trap first", () => {
  const step = (...run) => ["jobs:", "  api:", "    steps:", "      - name: Container answers", "        run: |", ...run.map((l) => `          ${l}`)].join("\n");
  const start = "docker run --detach --name api --publish 8080:8080 api:ci";
  assert.match(checkWorkflow(".github/workflows/ci.yml", step(start)).join(""), /container `api` detached with no `trap/);
  // A trap in an earlier step does not cover this one, and a trap for another container does not either.
  const elsewhere = ["jobs:", "  api:", "    steps:", "      - run: trap 'docker rm --force api' EXIT", "      - run: |", `          ${start}`].join("\n");
  assert.match(checkWorkflow(".github/workflows/ci.yml", elsewhere).join(""), /container `api`/);
  assert.match(checkWorkflow(".github/workflows/ci.yml", step("trap 'docker rm --force web' EXIT", start)).join(""), /container `api`/);
  const clean = (l) => !/container/.test(l);
  assert.ok(checkWorkflow(".github/workflows/ci.yml", step("trap 'docker rm --force api > /dev/null 2>&1 || true' EXIT", start)).every(clean));
  assert.ok(checkWorkflow(".github/workflows/ci.yml", step("docker run --rm -i api:ci")).every(clean));
});

test("an npm install without --ignore-scripts fails in a workflow and a Dockerfile; a comment does not", (t) => {
  const workflow = (run) => ["jobs:", "  web:", "    steps:", `      - run: ${run}`, "      # npm ci runs here, as the comment says"].join("\n");
  assert.match(checkWorkflow(".github/workflows/ci.yml", workflow("npm ci")).join(""), /ci\.yml:4 installs with npm without --ignore-scripts/);
  assert.match(checkWorkflow(".github/workflows/ci.yml", workflow("npm install --save-dev x")).join(""), /without --ignore-scripts/);
  assert.doesNotMatch(checkWorkflow(".github/workflows/ci.yml", workflow("npm ci --ignore-scripts")).join(""), /ignore-scripts/);
  assert.doesNotMatch(checkWorkflow(".github/workflows/ci.yml", workflow("npm run build")).join(""), /ignore-scripts/);
  const found = failures(fixture(t, {
    "services/api/Dockerfile": "FROM node:24\nRUN npm ci --omit=dev\n",
    "services/ok/Dockerfile": "FROM node:24\nRUN npm ci --omit=dev --ignore-scripts\n",
  }));
  assert.match(found, /services\/api\/Dockerfile:2 installs with npm without --ignore-scripts/);
  assert.doesNotMatch(found, /services\/ok\/Dockerfile/);
});

test("a verify.yml job missing from the gate's needs fails", () => {
  const workflow = (needs) => [
    "permissions:", "  contents: read", "jobs:",
    "  lint:", "    timeout-minutes: 5", "  test:", "    timeout-minutes: 5",
    "  verify:", "    needs:", ...needs.map((n) => `      - ${n}`), "      # a comment line is not a job", "    timeout-minutes: 5",
  ].join("\n");
  assert.match(checkGate("verify.yml", workflow(["lint"])).join(""), /job\(s\) test are missing/);
  assert.deepEqual(checkGate("verify.yml", workflow(["lint", "test"])), []);
  assert.match(checkGate("verify.yml", "jobs:\n  lint:\n    timeout-minutes: 5\n").join(""), /no aggregate `verify` job/);
});

test("a raw control character in a source file fails, and an escape does not", (t) => {
  const found = failures(fixture(t, { "src/raw.mjs": "const sep = \"\u0000\";\n", "src/escaped.mjs": "const sep = \"\\u0000\";\n" }));
  assert.match(found, /raw control character\(s\) in src\/raw\.mjs:1\./);
  assert.doesNotMatch(found, /escaped\.mjs/);
});

test("an invisible or text-reordering character fails wherever it hides, and its escape does not", (t) => {
  const found = failures(fixture(t, {
    "AGENTS.md": "# Rules\n\nBe careful.\u{E0049}\u{E0067}\u{E006E}\u{E006F}\u{E0072}\u{E0065}\n",
    "src/trojan.mjs": "const role = \"user\u202E \u2066// admin\u2069 \u2066\";\n",
    "docs/zero.md": "pass\u200Bword\n",
    "src/escaped.mjs": "const zwsp = \"\\u200B\";\n",
    "docs/plain.md": "Café, naïve, 日本語 and ✓ are ordinary text.\n",
    // Emoji spelt with a presentation selector, a keycap, a skin tone and joiners are ordinary text too.
    "docs/emoji.md": "\u26A0\uFE0F Read first. Made with \u2764\uFE0F. Step 1\uFE0F\u20E3. \u{1F469}\u{1F3FD}\u200D\u{1F4BB} and \u{1F468}\u200D\u{1F469}\u200D\u{1F467} wrote it.\n",
    // A selector or joiner outside an emoji is not.
    "docs/stray-selector.md": "admin\uFE0F\n",
    "docs/stray-joiner.md": "pass\u200Dword\n",
  }));
  assert.match(found, /invisible or text-reordering character\(s\) in AGENTS\.md:3, docs\/stray-joiner\.md:1, docs\/stray-selector\.md:1, docs\/zero\.md:1, src\/trojan\.mjs:1\./);
  assert.doesNotMatch(found, /escaped\.mjs|plain\.md|emoji\.md/);
});

test("an absolute path into a home directory fails; container paths, placeholders and URLs do not", (t) => {
  // Assembled at run time: written out whole, these paths would make this file fail the rule it tests.
  const users = "Us" + "ers";
  const found = failures(fixture(t, {
    "docs/mac.md": `Open /${users}/alice/project first.\n`,
    "docs/windows.md": `Run C:\\${users}\\bob\\tools\\x.exe\n`,
    "docs/forward.md": `cd C:/${users}/bob/src\n`,
    "docs/fine.md": "Clone to ~/src or /Users/<you>/src; see https://example.com/home/page and /usr/local/bin.\n",
    // /home/<name> inside a container is configuration, not anyone's machine.
    ".devcontainer/devcontainer.json": "{ \"remoteUser\": \"node\", \"mounts\": [\"source=cache,target=/home/node/.cache,type=volume\"] }\n",
    "compose.yml": "services:\n  app:\n    volumes: [\"./data:/home/app/data\"]\n",
  }));
  assert.match(found, /home directory in docs\/forward\.md:1, docs\/mac\.md:1, docs\/windows\.md:1\./);
  assert.doesNotMatch(found, /fine\.md|devcontainer\.json|compose\.yml/);
});

test("a module present without its lockfile or its verify script fails; a complete one passes", () => {
  const manifest = (scripts) => JSON.stringify({ scripts });
  const read = (path) => ({
    "services/api-ts/package.json": manifest({ verify: "npm test" }),
    "apps/web/package.json": manifest({ test: "vitest run" }),
  })[path];

  const complete = ["services/api-ts/package.json", "services/api-ts/package-lock.json", "services/api-ts/src/main.ts"];
  assert.deepEqual(checkModules(complete, read), []);
  assert.match(checkModules(complete.filter((p) => !p.endsWith("lock.json")), read).join(), /api-ts` is present but does not track `package-lock\.json`/);
  assert.match(
    checkModules(["apps/web/package.json", "apps/web/package-lock.json"], read).join(),
    /apps\/web\/package\.json` has no `verify` script/,
  );
  assert.match(
    checkModules(["services/api-py/pyproject.toml", "services/api-py/src/main.py"], read).join(),
    /api-py` is present but does not track `uv\.lock`/,
  );
  // A module that is not there is not a missing lockfile.
  assert.deepEqual(checkModules(["README.md"], read), []);
});

test("a repository with nothing tracked is fatal, not vacuously clean", (t) => {
  const root = mkdtempSync(join(tmpdir(), "hygiene-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, ".gitignore"), IGNORE);
  execFileSync("git", ["init", "-q"], { cwd: root, stdio: "ignore" });
  assert.match(checkRepoHygiene(root).fatal ?? "", /nothing is tracked/);
});

test("a directory that is not a git repository is fatal", (t) => {
  const root = mkdtempSync(join(tmpdir(), "hygiene-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, ".gitignore"), IGNORE);
  assert.match(checkRepoHygiene(root).fatal ?? "", /git repository/);
});
