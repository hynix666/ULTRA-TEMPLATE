// The contract check must be seen to fail. A runner that only ever meets services that comply
// proves nothing: it passes just as well when it compares nothing.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { encodeBody, judge, loadCases, runCases } from "../scripts/check-contract.mjs";

/** A minimal task service that is right about everything except what `mistakes` says. */
function fakeService(t, mistakes = {}) {
  const tasks = new Map();
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const send = (status, body) => {
        res.writeHead(status, { "content-type": mistakes.textErrors && status >= 400 ? "text/plain" : "application/json" });
        res.end(mistakes.textErrors && status >= 400 ? "nope" : JSON.stringify(body));
      };
      if (req.url === "/healthz") return send(200, { status: "ok" });
      if (req.url === "/api/tasks" && req.method === "POST") {
        const body = JSON.parse(raw || "{}");
        if ((body.title ?? "").trim() === "") return send(mistakes.emptyTitle ?? 422, { error: "title must not be empty" });
        const task = { id: `t${tasks.size + 1}`, title: body.title.trim(), status: "todo", createdAt: "x", updatedAt: "x" };
        tasks.set(task.id, task);
        return send(201, task);
      }
      const match = /^\/api\/tasks\/([^/]+)$/.exec(req.url ?? "");
      if (match && req.method === "GET") return tasks.has(match[1]) ? send(200, tasks.get(match[1])) : send(404, { error: "task not found" });
      return send(404, { error: "not found" });
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`));
    t.after(() => server.close());
  });
}

const CASES = [
  { name: "health", method: "GET", path: "/healthz", status: 200, json: { status: "ok" } },
  { name: "create", method: "POST", path: "/api/tasks", body: '{"title":" a "}', status: 201, task: { title: "a", status: "todo" } },
  { name: "empty title", method: "POST", path: "/api/tasks", body: '{"title":" "}', status: 422, error: true },
  { name: "get", method: "GET", path: "/api/tasks/{id}", status: 200, task: { status: "todo" } },
  { name: "unknown", method: "GET", path: "/nope", status: 404, error: true },
];

test("a service that keeps the contract passes", async (t) => {
  assert.deepEqual(await runCases(await fakeService(t), CASES), []);
});

test("a wrong status fails, and names the case", async (t) => {
  const failures = await runCases(await fakeService(t, { emptyTitle: 400 }), CASES);
  assert.deepEqual(failures.map((f) => f.name), ["empty title"]);
  assert.match(failures[0].problems.join(), /status 400, expected 422/);
});

test("the right status with an error that is not JSON still fails", async (t) => {
  const failures = await runCases(await fakeService(t, { textErrors: true }), CASES);
  assert.deepEqual(failures.map((f) => f.name), ["empty title", "unknown"]);
  assert.match(failures[1].problems.join(), /no \{"error"|content-type text\/plain/);
});

test("judge checks the task's fields and values, not only the status", () => {
  const answer = (body) => ({ status: 201, type: "application/json", text: JSON.stringify(body) });
  const wanted = { status: 201, task: { status: "todo" } };
  assert.deepEqual(judge(wanted, answer({ id: "1", title: "a", status: "todo", createdAt: "x", updatedAt: "x" })), []);
  assert.match(judge(wanted, answer({ id: "1", title: "a", status: "todo" })).join(), /task fields/);
  assert.match(judge(wanted, answer({ id: "1", title: "a", status: "done", createdAt: "x", updatedAt: "x" })).join(), /status "done"/);
});

test("the committed cases are well formed and each name is unique", () => {
  const cases = loadCases();
  assert.ok(cases.length >= 30, `${cases.length} cases`);
  assert.equal(new Set(cases.map((c) => c.name)).size, cases.length);
  for (const c of cases) {
    assert.match(c.method, /^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)$/, c.name);
    assert.ok(c.path.startsWith("/"), c.name);
    assert.ok(Number.isInteger(c.status), c.name);
  }
  // Large bodies are described, not stored: the file stays small and reviewable.
  assert.equal(JSON.parse(encodeBody({ title: { repeat: "ab", times: 3 } })).title, "ababab");
});
