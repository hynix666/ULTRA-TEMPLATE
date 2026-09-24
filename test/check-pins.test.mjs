// The pin report must be seen to report: a stale pin, a lookup that failed, and a pin nobody catalogued.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { report, table, unknownPins } from "../scripts/check-pins.mjs";
import { ROOT } from "../scripts/modules.mjs";

const workflows = () => {
  const files = {};
  for (const dir of [".github/workflows", ...readdirSync(join(ROOT, ".github/actions")).map((d) => `.github/actions/${d}`)]) {
    for (const name of readdirSync(join(ROOT, dir)).filter((n) => /\.ya?ml$/.test(n))) files[`${dir}/${name}`] = readFileSync(join(ROOT, dir, name), "utf8");
  }
  return files;
};

test("every pin-shaped line in this repository's workflows is one the report reads", () => {
  assert.deepEqual(unknownPins(workflows()), []);
});

test("a new hand pin that the report does not read is named", () => {
  const files = { ".github/workflows/lint.yml": 'env:\n  SHELLCHECK_VERSION: "0.10.0"\n  # TOOL_VERSION: "1.0.0" in a comment is not a pin\n' };
  assert.deepEqual(unknownPins(files), ['.github/workflows/lint.yml:2: SHELLCHECK_VERSION: "0.10.0"']);
  const run = { ".github/workflows/scan.yml": "      - run: go run example.com/tool@v1.2.3 ./...\n      - run: uvx tool==4.5.6\n" };
  assert.equal(unknownPins(run).length, 2);
});

test("a pin behind its latest release is reported, and one at it is current", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "pins-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (path, text) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  write(".github/workflows/security.yml", 'GITLEAKS_VERSION: "8.30.1"\nTRIVY_VERSION: "0.74.0"\ngo run golang.org/x/vuln/cmd/govulncheck@v1.8.0\nuvx pip-audit==2.10.1\n');
  const answers = {
    "https://api.github.com/repos/gitleaks/gitleaks/releases/latest": { tag_name: "v8.31.0" },
    "https://api.github.com/repos/aquasecurity/trivy/releases/latest": { tag_name: "v0.74.0" },
    "https://api.github.com/repos/golang/vuln/tags?per_page=100": [{ name: "v1.10.0" }, { name: "v1.9.0" }, { name: "v1.11.0-rc.1" }],
  };
  const fetch = async (url) => (url in answers ? new Response(JSON.stringify(answers[url])) : new Response("{}", { status: 503 }));
  const rows = await report({ root, fetch });
  const byName = Object.fromEntries(rows.map((row) => [row.pin.name, row]));
  assert.deepEqual(Object.keys(byName), ["gitleaks", "Trivy", "govulncheck", "pip-audit"]);
  assert.equal(byName.gitleaks.behind, true);
  assert.equal(byName.Trivy.behind, false);
  // Tags are compared as versions, not as text, and a release candidate is not a release.
  assert.equal(byName.govulncheck.newest, "1.10.0");
  assert.match(byName["pip-audit"].error, /PyPI pip-audit answered 503/);
  const rendered = table(rows);
  assert.match(rendered, /\| gitleaks \| 8\.30\.1 \| 8\.31\.0 \| \*\*newer release\*\* \|/);
  assert.match(rendered, /\| pip-audit \| 2\.10\.1 \| \? \| could not check: PyPI pip-audit answered 503 \|/);
});
