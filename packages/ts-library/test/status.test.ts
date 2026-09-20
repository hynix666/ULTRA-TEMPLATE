import assert from "node:assert/strict";
import { test } from "node:test";
import { canTransition, isStatus, nextStatuses, parseStatus, STATUSES, type Status } from "../src/index.ts";

test("the transition rules match the task services", () => {
  const allowed = new Set(["todo>in_progress", "in_progress>todo", "in_progress>done"]);
  for (const from of STATUSES) {
    for (const to of STATUSES) {
      assert.equal(canTransition(from, to), allowed.has(`${from}>${to}`), `${from} to ${to}`);
    }
  }
  assert.deepEqual(nextStatuses("in_progress"), ["todo", "done"]);
  assert.deepEqual(nextStatuses("done"), []);
});

test("external input is validated", () => {
  assert.equal(parseStatus("done"), "done");
  for (const bad of ["DONE", "", null, 3, undefined]) {
    assert.equal(isStatus(bad), false, String(bad));
    assert.throws(() => parseStatus(bad), TypeError, String(bad));
  }
});

test("the public API is exactly what index.ts exports", async () => {
  const api = await import("../src/index.ts");
  assert.deepEqual(Object.keys(api).sort(), ["STATUSES", "canTransition", "isStatus", "nextStatuses", "parseStatus"]);
  const status: Status = "todo";
  assert.ok(isStatus(status));
});
