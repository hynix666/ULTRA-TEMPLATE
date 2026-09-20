import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { LikeC4 } from "likec4";
import { clientDependencies, undocumented } from "../rules.mjs";

const workspace = fileURLToPath(new URL("../model", import.meta.url));
// throwIfInvalid: a model with a syntax or reference error fails here, not later in a diagram.
const model = await (await LikeC4.fromWorkspace(workspace, { throwIfInvalid: true })).computedModel();

test("every service and web app states its technology and purpose", () => {
  assert.deepEqual(undocumented(model), []);
});

test("no service depends on a web app", () => {
  assert.deepEqual(clientDependencies(model), []);
});

// A rule proven only against a clean model passes just as well when it is broken.
test("the rules fire on a model that breaks them", () => {
  const element = (id, kind, technology, description) => ({ id, kind, technology, description: { isEmpty: description === "" } });
  const api = element("product.api", "service", null, "");
  const web = element("product.web", "webapp", "React", "Lists tasks");
  const broken = { elements: () => [api, web], relationships: () => [{ source: api, target: web }] };

  assert.deepEqual(undocumented(broken), ["product.api has no technology", "product.api has no description"]);
  assert.deepEqual(clientDependencies(broken), ["product.api depends on the web app product.web"]);
});
