// The image probe must be seen to fail: a probe that meets only images that behave proves nothing.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { CONTRACT_FILE, judgeImage, stopSeconds } from "../scripts/probe-image.mjs";

// A contract of its own, so this holds in every project, with or without a task service.
const contract = {
  config: {
    PORT: { reportedAs: "port", binds: true, default: { value: "80", effective: 80 } },
    WAIT: { reportedAs: "waitMs", default: { value: "2s", effective: 2000 } },
  },
  startup: {
    ready: { method: "GET", path: "/healthz", status: 200 },
    listening: { level: "info", msg: "listening" },
    stopped: { signal: "SIGTERM", exitCode: 0, within: "WAIT" },
  },
};
const log = (fields) => JSON.stringify({ time: "t", level: "info", msg: "listening", ...fields });

test("an image that serves the defaults and stops cleanly passes", () => {
  assert.deepEqual(judgeImage(contract, { ready: true, logs: `not json\n${log({ port: 80, waitMs: 2000 })}\n`, exitCode: 0 }), []);
});

test("every way an image can differ from the contract is reported", () => {
  const found = judgeImage(contract, { ready: false, logs: log({ port: 8081, waitMs: 2000 }), exitCode: 137 }).join("\n");
  assert.match(found, /never answered GET \/healthz with 200 on the default port/);
  assert.match(found, /with PORT unset it reports port 8081, expected the default 80/);
  assert.match(found, /sent SIGTERM, it exited 137, expected 0/);
  assert.match(judgeImage(contract, { ready: true, logs: "", exitCode: 0 }).join(), /wrote no listening line/);
});

test("docker stop waits out the default shutdown timeout before it kills", () => {
  assert.equal(stopSeconds(contract), 2 + 5);
  assert.throws(() => stopSeconds({ ...contract, startup: { ...contract.startup, stopped: { ...contract.startup.stopped, within: "NOPE" } } }), /names NOPE, which config does not state/);
});

test("the committed contract says how a service stops, by a variable it states", { skip: !exists(CONTRACT_FILE) && "no task service here" }, () => {
  const committed = JSON.parse(readFileSync(CONTRACT_FILE, "utf8"));
  assert.ok(stopSeconds(committed) > 0);
});

function exists(file) {
  try {
    readFileSync(file);
    return true;
  } catch {
    return false;
  }
}
