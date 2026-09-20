import assert from "node:assert/strict";
import { test } from "node:test";
import { createTask, listTasks, moveTask } from "../src/application/task-tools.ts";
import { DomainError } from "../src/domain/task.ts";
import { fakeGateway, task } from "./fake-gateway.ts";

test("creating a task validates the title before spending a request", async () => {
  const gateway = fakeGateway();
  const created = await createTask(gateway, "  Write the README  ");
  assert.equal(created.title, "Write the README");
  assert.equal(created.status, "todo");

  await assert.rejects(() => createTask(gateway, "   "), DomainError);
  assert.equal(gateway.tasks.length, 1, "a refused title must not reach the API");
});

test("a move the API would refuse is refused here, with the moves that would work", async () => {
  const gateway = fakeGateway([task({ id: "t1", status: "todo" })]);
  await assert.rejects(() => moveTask(gateway, "t1", "done"), /legal moves from todo: in_progress/);
  assert.equal(gateway.tasks[0]?.status, "todo");

  const moved = await moveTask(gateway, "t1", "in_progress");
  assert.equal(moved.status, "in_progress");
});

test("an unknown id and an unknown status each fail before the call", async () => {
  const gateway = fakeGateway([task({ id: "t1" })]);
  await assert.rejects(() => moveTask(gateway, "t9", "in_progress"), (err: DomainError) => err.code === "NOT_FOUND");
  await assert.rejects(() => moveTask(gateway, "t1", "archived"), (err: DomainError) => err.code === "UNKNOWN_STATUS");
});

test("listing passes the gateway's answer through untouched", async () => {
  const tasks = [task({ id: "t1" }), task({ id: "t2", status: "done" })];
  assert.deepEqual(await listTasks(fakeGateway(tasks)), tasks);
});
