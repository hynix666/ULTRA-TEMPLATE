// The facts check must be seen to fail: a comparison that never meets a module that disagrees proves
// nothing, since it passes just as well when it compares nothing.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { compareFacts, statedFacts } from "../scripts/check-facts.mjs";
import { FACTS } from "../scripts/modules.mjs";
import { loadRules, RULES_FILE } from "../scripts/rules/load.mjs";

const rules = loadRules();
const copy = () => structuredClone(rules);
const all = Object.keys(rules);
const compareRules = compareFacts;

test("the rules file is well formed: every move names a status, and every status has its moves", () => {
  assert.ok(rules.statuses.length > 0);
  assert.deepEqual(Object.keys(rules.transitions).sort(), [...rules.statuses].sort());
  for (const [from, to] of Object.entries(rules.transitions)) {
    for (const next of to) assert.ok(rules.statuses.includes(next), `${from} → ${next} names no status`);
    assert.ok(!to.includes(from), `${from} may move to itself; staying put is not a move`);
  }
  assert.ok(Number.isInteger(rules.maxTitleLength) && rules.maxTitleLength > 0);
});

test("a module that states the same rules agrees, with its moves in any order and no title length", () => {
  assert.deepEqual(compareRules(rules, copy(), all), []);
  const reordered = copy();
  reordered.transitions.in_progress = [...reordered.transitions.in_progress].reverse();
  delete reordered.maxTitleLength;
  // A module that validates no titles declares, and prints, only the rest.
  assert.deepEqual(compareRules(rules, reordered, all.filter((key) => key !== "maxTitleLength")), []);
});

test("every way a module can disagree is reported", () => {
  const extraMove = copy();
  extraMove.transitions.done = ["todo"];
  assert.match(compareRules(rules, extraMove, all).join(), /moves from `done` are \["todo"\], expected \[\]/);

  const missingMove = copy();
  delete missingMove.transitions.todo;
  assert.match(compareRules(rules, missingMove, all).join(), /states no moves from `todo`/);

  const strayStatus = copy();
  strayStatus.transitions.blocked = [];
  assert.match(compareRules(rules, strayStatus, all).join(), /moves from `blocked`, which is not a status/);

  const statuses = copy();
  statuses.statuses = ["todo", "done", "in_progress"];
  assert.match(compareRules(rules, statuses, all).join(), /statuses is \["todo","done","in_progress"\], expected/);

  const title = copy();
  title.maxTitleLength = rules.maxTitleLength + 1;
  assert.match(compareRules(rules, title, all).join(), new RegExp(`maxTitleLength is ${rules.maxTitleLength + 1}, expected ${rules.maxTitleLength}`));

  const unknownKey = { ...copy(), priorities: [] };
  assert.match(compareRules(rules, unknownKey, all).join(), /states `priorities`, which is not a fact this project states/);

  assert.match(compareRules(rules, { maxTitleLength: rules.maxTitleLength }, all).join(), /does not state `statuses`.*does not state `transitions`/);
  // A fact the module prints but its manifest does not declare is one nothing would notice it drop.
  assert.match(compareRules(rules, copy(), ["statuses", "transitions"]).join(), /states `maxTitleLength`, which its module.json does not list/);
  assert.deepEqual(compareRules(rules, [], all), ["did not print a JSON object"]);
});

// A contract of its own, so these hold in every project that keeps this check, with or without a task
// service and the contract that comes with one.
function contractFile(t, config) {
  const dir = mkdtempSync(join(tmpdir(), "facts-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "tasks-api.json");
  if (config !== undefined) writeFileSync(file, JSON.stringify({ config }));
  return file;
}
const PORT = { $comment: "x", WAIT: { default: { effective: 5 } }, LISTEN: { binds: true, default: { effective: 9 } } };

test("every fact a manifest may declare is one the files can state", (t) => {
  assert.deepEqual(Object.keys(statedFacts({ rulesFile: RULES_FILE, contractFile: contractFile(t, PORT) })).sort(), [...FACTS].sort());
});

test("the API's default port comes from the contract, and is not compared where there is no contract", (t) => {
  // The port is the default of whichever variable binds one.
  const stated = statedFacts({ rulesFile: RULES_FILE, contractFile: contractFile(t, PORT) });
  assert.equal(stated.apiDefaultPort, 9);
  const keys = [...all, "apiDefaultPort"];
  assert.deepEqual(compareFacts(stated, { ...copy(), apiDefaultPort: 9 }, keys), []);
  assert.match(compareFacts(stated, { ...copy(), apiDefaultPort: 8 }, keys).join(), /apiDefaultPort is 8, expected 9/);

  // A project with the library alone keeps the rules but has no contract.
  const alone = statedFacts({ rulesFile: RULES_FILE, contractFile: contractFile(t, undefined) });
  assert.ok(!("apiDefaultPort" in alone));
  assert.deepEqual(compareFacts(alone, { ...copy(), apiDefaultPort: 1 }, keys), [], "a fact stated nowhere here is not compared");
  assert.match(compareFacts(alone, copy(), keys).join(), /does not state `apiDefaultPort`/, "but the module must still print what it declares");
});
