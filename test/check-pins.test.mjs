// The pin report must be seen to report: a pin behind its latest release, and a lookup that failed.
import assert from "node:assert/strict";
import { test } from "node:test";
import { report, table } from "../scripts/check-pins.mjs";

test("a pin behind its latest release is reported, one at it is current, and a failed lookup says so", async () => {
  const tools = {
    ahead: { version: "1.0.0", for: "ci", releases: { github: "octo/ahead" }, run: ["ahead"] },
    level: { version: "2.0.0", for: "ci", releases: { github: "octo/level" }, run: ["level"] },
    tagged: { version: "1.8.0", for: "ci", releases: { githubTags: "octo/tagged" }, run: ["tagged"] },
    audit: { version: "3.0.0", for: "ci", releases: { pypi: "audit" }, run: ["audit"] },
  };
  const answers = {
    "https://api.github.com/repos/octo/ahead/releases/latest": { tag_name: "v1.1.0" },
    "https://api.github.com/repos/octo/level/releases/latest": { tag_name: "v2.0.0" },
    "https://api.github.com/repos/octo/tagged/tags?per_page=100": [{ name: "v1.10.0" }, { name: "v1.9.0" }, { name: "v1.11.0-rc.1" }],
  };
  const fetch = async (url) => (url in answers ? new Response(JSON.stringify(answers[url])) : new Response("{}", { status: 503 }));
  const byName = Object.fromEntries((await report({ tools, fetch })).map((row) => [row.name, row]));
  assert.equal(byName.ahead.behind, true);
  assert.equal(byName.level.behind, false);
  // Tags are compared as versions, not as text, and a release candidate is not a release.
  assert.equal(byName.tagged.newest, "1.10.0");
  assert.match(byName.audit.error, /PyPI audit answered 503/);
  const rendered = table(Object.values(byName));
  assert.match(rendered, /\| ahead \| 1\.0\.0 \| 1\.1\.0 \| \*\*newer release\*\* \|/);
  assert.match(rendered, /\| audit \| 3\.0\.0 \| \? \| could not check: PyPI audit answered 503 \|/);
});
