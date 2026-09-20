import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryTaskRepository } from "../src/adapters/memory-task-repository.ts";
import type { TaskRepository } from "../src/application/ports.ts";
import { TaskService } from "../src/application/task-service.ts";
import { DomainError, type Task } from "../src/domain/task.ts";

const NOW = "2026-01-02T03:04:05.000Z";

const isCode = (code: DomainError["code"]) => (err: unknown) => err instanceof DomainError && err.code === code;

function setup() {
  const store = new MemoryTaskRepository();
  let saves = 0;
  const repository: TaskRepository = {
    save: (task: Task) => {
      saves++;
      return store.save(task);
    },
    get: (id) => store.get(id),
    list: () => store.list(),
  };
  const service = new TaskService({ repository, clock: { now: () => NOW }, ids: { next: () => "id-1" } });
  return { service, store, saves: () => saves };
}

test("create stores a valid task", async () => {
  const { service, store } = setup();
  const task = await service.create("ship it");
  assert.equal(task.id, "id-1");
  assert.deepEqual(await store.get("id-1"), task);
});

test("an invalid title is refused without saving", async () => {
  const { service, saves } = setup();
  await assert.rejects(service.create(" "), isCode("EMPTY_TITLE"));
  assert.equal(saves(), 0);
});

test("get of a missing task is NOT_FOUND", async () => {
  await assert.rejects(setup().service.get("nope"), isCode("NOT_FOUND"));
});

test("a refused transition stores nothing; an allowed one is stored", async () => {
  const { service, store, saves } = setup();
  await service.create("ship it");
  await assert.rejects(service.transition("id-1", "done"), isCode("INVALID_TRANSITION"));
  assert.equal(saves(), 1);
  const moved = await service.transition("id-1", "in_progress");
  assert.deepEqual(await store.get("id-1"), moved);
});

test("the memory repository keeps insertion order when a task is replaced", async () => {
  const store = new MemoryTaskRepository();
  const base = { status: "todo", createdAt: NOW, updatedAt: NOW } as const;
  await store.save({ ...base, id: "a", title: "first" });
  await store.save({ ...base, id: "b", title: "second" });
  await store.save({ ...base, id: "a", title: "first, renamed" });
  assert.deepEqual((await store.list()).map((t) => t.title), ["first, renamed", "second"]);
});
