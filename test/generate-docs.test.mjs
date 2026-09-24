// Generated documentation must be seen to go stale: a generator whose check passes over any text proves
// nothing. Every source here is an in-memory file, so this holds in every project that keeps the script.
import assert from "node:assert/strict";
import { test } from "node:test";
import { bytes, DocsError, GENERATORS, regenerate } from "../scripts/generate-docs.mjs";

const files = {
  ".node-version": "24\n",
  "services/api/go.mod": "module x\n\ngo 1.26.1\n",
  "svc/pyproject.toml": '[project]\nrequires-python = ">=3.13,<4"\n',
  "scripts/contract/tasks-api.json": JSON.stringify({
    limits: { maxBodyBytes: 1048576, requestId: { maxLength: 128 } },
    config: { $comment: "x", PORT: { meaning: "The port", default: { value: "8080", effective: 8080 } } },
  }),
  "scripts/rules/task-rules.json": JSON.stringify({ maxTitleLength: 200 }),
  "scripts/tools/tools.json": JSON.stringify({ tools: { lint: { version: "1.2.3", for: "go", releases: { github: "o/lint" }, platforms: {}, checksums: { file: "x" } } } }),
};
const read = (path) => {
  if (!(path in files)) throw new DocsError(`${path} is not here`);
  return files[path];
};

test("inline blocks take a value from the file they name", () => {
  const text = [
    "Node <!-- generated:version .node-version -->?<!-- /generated -->",
    "Go <!-- generated:version services/api/go.mod -->?<!-- /generated -->",
    "Python <!-- generated:floor svc/pyproject.toml -->?<!-- /generated -->",
    "Port <!-- generated:contract config.PORT.default.value -->?<!-- /generated -->",
    "Cap <!-- generated:contract limits.maxBodyBytes bytes -->?<!-- /generated -->",
    "Title <!-- generated:rules maxTitleLength -->?<!-- /generated -->",
    "Lint <!-- generated:tool lint -->?<!-- /generated -->",
  ].join("\n");
  const { text: out, stale } = regenerate(text, read);
  assert.equal(stale.length, 7);
  assert.deepEqual(out.split("\n").map((line) => line.replace(/<!--[^>]*-->/g, "")), ["Node 24", "Go 1.26", "Python 3.13", "Port 8080", "Cap 1 MiB", "Title 200", "Lint 1.2.3"]);
  assert.deepEqual(regenerate(out, read).stale, [], "a second pass finds nothing stale");
});

test("a block of its own keeps its lines, and a fill writes its template with each value filled in", () => {
  const text = "<!-- generated:config-table -->\nold\n<!-- /generated -->\n<!-- generated:fill\n```bash\ncurl localhost:{{contract config.PORT.default.value}}/\n```\n-->\n```bash\ncurl localhost:1/\n```\n<!-- /generated -->\n";
  const { text: out, stale } = regenerate(text, read);
  assert.deepEqual(stale, ["config-table", "fill"]);
  assert.match(out, /<!-- generated:config-table -->\n\| Variable \| Default \| Meaning \|\n\|---\|---\|---\|\n\| `PORT` \| `8080` \| The port \|\n<!-- \/generated -->/);
  assert.match(out, /-->\n```bash\ncurl localhost:8080\/\n```\n<!-- \/generated -->/);
  assert.match(out, /\{\{contract config\.PORT\.default\.value\}\}/, "the template itself is kept");
});

test("a block that names nothing known, or a source that is not here, fails and says which", () => {
  assert.throws(() => regenerate("<!-- generated:nope -->x<!-- /generated -->", read, "doc.md"), /doc\.md: no generated block is called "nope"/);
  assert.throws(() => regenerate("<!-- generated:version gone/go.mod -->x<!-- /generated -->", read, "doc.md"), /gone\/go\.mod is not here/);
  assert.throws(() => regenerate("<!-- generated:contract limits.nothing -->x<!-- /generated -->", read), /has nothing at limits\.nothing/);
  assert.throws(() => regenerate("<!-- generated:version README.md -->x<!-- /generated -->", read), /not a file that declares a toolchain version/);
});

test("sizes are written as a reader thinks of them, exactly", () => {
  assert.equal(bytes(1048576), "1 MiB");
  assert.equal(bytes(2048), "2 KiB");
  assert.equal(bytes(1000), "1000 bytes");
  assert.ok(Object.keys(GENERATORS).length >= 10);
});
