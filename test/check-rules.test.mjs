// The rules check must be seen to fail: a comparison that never meets a module that disagrees proves
// nothing, since it passes just as well when it compares nothing.
import assert from "node:assert/strict";
import { test } from "node:test";
import { compareRules } from "../scripts/check-rules.mjs";
import { loadRules } from "../scripts/rules/load.mjs";

const rules = loadRules();
const copy = () => structuredClone(rules);

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
  assert.deepEqual(compareRules(rules, copy()), []);
  const reordered = copy();
  reordered.transitions.in_progress = [...reordered.transitions.in_progress].reverse();
  delete reordered.maxTitleLength;
  assert.deepEqual(compareRules(rules, reordered), []);
});

test("every way a module can disagree is reported", () => {
  const extraMove = copy();
  extraMove.transitions.done = ["todo"];
  assert.match(compareRules(rules, extraMove).join(), /moves from `done` are \["todo"\], expected \[\]/);

  const missingMove = copy();
  delete missingMove.transitions.todo;
  assert.match(compareRules(rules, missingMove).join(), /states no moves from `todo`/);

  const strayStatus = copy();
  strayStatus.transitions.blocked = [];
  assert.match(compareRules(rules, strayStatus).join(), /moves from `blocked`, which is not a status/);

  const statuses = copy();
  statuses.statuses = ["todo", "done", "in_progress"];
  assert.match(compareRules(rules, statuses).join(), /statuses are/);

  const title = copy();
  title.maxTitleLength = 100;
  assert.match(compareRules(rules, title).join(), /maxTitleLength is 100, expected 200/);

  const unknownKey = { ...copy(), priorities: [] };
  assert.match(compareRules(rules, unknownKey).join(), /states `priorities`, which the rules do not have/);

  assert.match(compareRules(rules, { maxTitleLength: 200 }).join(), /does not state `statuses`.*does not state `transitions`/);
  assert.deepEqual(compareRules(rules, []), ["did not print a JSON object"]);
});
