import assert from "node:assert/strict";
import { test } from "node:test";
import { GatewayError } from "../src/application/ports.ts";
import { createHttpTaskGateway } from "../src/adapters/http-task-gateway.ts";
import { task } from "./fake-gateway.ts";

interface Call {
  url: string;
  method: string;
  body: string | undefined;
}

/** A fetch that records what it was asked for and answers with what the test wants. */
function stubFetch(answer: (call: Call) => Response): { fetch: typeof globalThis.fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(input), method: init?.method ?? "GET", body: init?.body as string | undefined };
    calls.push(call);
    return answer(call);
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const gatewayFor = (fetch: typeof globalThis.fetch) => createHttpTaskGateway({ baseUrl: "http://localhost:8080", timeoutMs: 50, fetch });

test("each call goes to the documented route with the documented body", async () => {
  const { fetch, calls } = stubFetch(({ method }) => json(method === "GET" ? [task()] : task({ status: "in_progress" })));
  const gateway = gatewayFor(fetch);

  assert.deepEqual(await gateway.list(), [task()]);
  await gateway.create("Write the README");
  await gateway.move("t 1/2", "in_progress");

  assert.deepEqual(calls.map((call) => `${call.method} ${call.url}`), [
    "GET http://localhost:8080/api/tasks",
    "POST http://localhost:8080/api/tasks",
    // The id is a path segment, so a slash or a space in one must not change the route.
    "PATCH http://localhost:8080/api/tasks/t%201%2F2/status",
  ]);
  assert.equal(calls[1]?.body, '{"title":"Write the README"}');
  assert.equal(calls[2]?.body, '{"status":"in_progress"}');
});

test("a base URL with a path or a trailing slash still addresses /api/tasks", async () => {
  const { fetch, calls } = stubFetch(() => json([]));
  await createHttpTaskGateway({ baseUrl: "http://tasks.internal/", timeoutMs: 50, fetch }).list();
  assert.equal(calls[0]?.url, "http://tasks.internal/api/tasks");
});

test("an error status is reported with the status and what the body said", async () => {
  const { fetch } = stubFetch(() => json({ error: "not found" }, 404));
  await assert.rejects(
    () => gatewayFor(fetch).move("t1", "done"),
    (err: GatewayError) => err instanceof GatewayError && /returned 404: \{"error":"not found"\}/.test(err.message),
  );
});

test("a body that is not JSON, and a response that is not a task, both fail loudly", async () => {
  const notJson = stubFetch(() => new Response("<html>502</html>", { status: 200 }));
  await assert.rejects(() => gatewayFor(notJson.fetch).list(), /not JSON/);

  const notATask = stubFetch(() => json([{ id: "t1", title: "x", status: "todo" }]));
  await assert.rejects(() => gatewayFor(notATask.fetch).list(), /createdAt must be a non-empty string/);
});

test("a request that never answers is abandoned, and says so", async () => {
  const gateway = createHttpTaskGateway({
    baseUrl: "http://localhost:8080",
    timeoutMs: 20,
    fetch: (async (_input: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      })) as typeof globalThis.fetch,
  });
  await assert.rejects(() => gateway.list(), /no answer within 20 ms/);
});
