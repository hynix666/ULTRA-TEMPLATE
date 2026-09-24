import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test, type TestContext } from "node:test";
import { withRequestLog } from "../src/adapters/request-log.ts";

/** A server whose inner handler answers `status`, a clock that advances 1.5 ms per reading, and its log. */
async function start(t: TestContext, status: number) {
  const lines: Record<string, unknown>[] = [];
  let readings = 0;
  const handler = withRequestLog(
    async (_req, res) => {
      res.writeHead(status).end();
    },
    (entry) => lines.push(entry),
    { monotonic: () => ++readings * 1.5, newId: () => "generated-1" },
  );
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, lines };
}

test("a usable request id is echoed, and the request is logged once", async (t) => {
  const { base, lines } = await start(t, 409);
  const res = await fetch(`${base}/api/tasks/t1/status?x=secret`, { method: "PATCH", headers: { "x-request-id": "abc-123.X_y" } });
  assert.equal(res.headers.get("x-request-id"), "abc-123.X_y");
  assert.deepEqual(lines, [
    {
      level: "info",
      msg: "request",
      method: "PATCH",
      path: "/api/tasks/t1/status",
      status: 409,
      durationMs: 1.5,
      requestId: "abc-123.X_y",
    },
  ]);
});

test("a missing or unsafe request id is replaced", async (t) => {
  const { base, lines } = await start(t, 200);
  for (const sent of [undefined, "has space", "a".repeat(129)]) {
    const res = await fetch(`${base}/healthz`, sent === undefined ? {} : { headers: { "x-request-id": sent } });
    assert.equal(res.headers.get("x-request-id"), "generated-1", String(sent));
  }
  assert.deepEqual(
    lines.map((line) => line["requestId"]),
    ["generated-1", "generated-1", "generated-1"],
  );
});
