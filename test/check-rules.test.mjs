// The rules check must be seen to fail: a comparison that never meets a module that disagrees proves
// nothing, since it passes just as well when it compares nothing.
import assert from "node:assert/strict";
import { test } from "node:test";
import { compareRules } from "../scripts/check-rules.mjs";
import { loadRules } from "../scripts/rules/load.mjs";

const rules = loadRules();
const copy = () => structuredClone(rules);
const all = Object.keys(rules);

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
  assert.match(compareRules(rules, statuses, all).join(), /statuses are/);

  const title = copy();
  title.maxTitleLength = rules.maxTitleLength + 1;
  assert.match(compareRules(rules, title, all).join(), new RegExp(`maxTitleLength is ${rules.maxTitleLength + 1}, expected ${rules.maxTitleLength}`));

  const unknownKey = { ...copy(), priorities: [] };
  assert.match(compareRules(rules, unknownKey, all).join(), /states `priorities`, which the rules do not have/);

  assert.match(compareRules(rules, { maxTitleLength: rules.maxTitleLength }, all).join(), /does not state `statuses`.*does not state `transitions`/);
  // A fact the module prints but its manifest does not declare is one nothing would notice it drop.
  assert.match(compareRules(rules, copy(), ["statuses", "transitions"]).join(), /states `maxTitleLength`, which its module.json does not list/);
  assert.deepEqual(compareRules(rules, [], all), ["did not print a JSON object"]);
});
