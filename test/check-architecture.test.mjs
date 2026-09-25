// The model check must be seen to fail: one that never meets a model out of step with the modules
// proves nothing.
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkModel, modelLinks } from "../scripts/check-architecture.mjs";

const modules = [
  { id: "api", dir: "services/api" },
  { id: "web", dir: "apps/web" },
  { id: "architecture", dir: "architecture" },
];
const model = (lines) => modelLinks([{ path: "architecture/model/system.c4", text: lines.join("\n") }]);
const both = ["  api = service 'api' {", "    link ../../services/api/README.md 'README'", "  }", "  web = webapp 'web' {", "    link ../../apps/web/README.md 'README'", "  }"];

test("a model with one element per module agrees, and the model's own module needs none", () => {
  assert.deepEqual(checkModel(modules, model(both), "architecture/model"), []);
});

test("links are read relative to the file they are in, and a web address is not a module", () => {
  assert.deepEqual(model(["link ../../services/api/README.md 'README'", "link https://example.test/docs 'Docs'"]).map((l) => l.target), ["services/api/README.md"]);
});

test("a module missing from the model, a module drawn twice, and an element whose module is gone all fail", () => {
  assert.match(checkModel(modules, model(both.slice(0, 3)), "architecture/model").join(), /web \(apps\/web\) is here, but no element of the model links to apps\/web\/README\.md/);
  assert.match(checkModel(modules, model([...both, "    link ../../apps/web/README.md 'README'"]), "architecture/model").join(), /web has 2 elements linking to apps\/web\/README\.md/);
  assert.match(
    checkModel(modules, model([...both, "    link ../../services/gone/README.md 'README'"]), "architecture/model").join(),
    /system\.c4:7 links to services\/gone\/README\.md, which is not the README of a module here/,
  );
  // A directory that merely shares a prefix with the model's is still a module to draw.
  assert.match(checkModel([...modules, { id: "arch2", dir: "architecture-2" }], model(both), "architecture/model").join(), /arch2 \(architecture-2\) is here/);
});
