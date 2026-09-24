/**
 * The conformance suite for the TaskRepository port: the behaviour the service relies on from any store.
 * The in-memory store passes it, and a store that replaces it, such as a database adapter, runs the same
 * suite against a fresh database of its own: passing is what makes it a replacement rather than a rewrite.
 *
 * It returns every way the stores differ from the port's contract, so its own test can show it failing
 * a broken store; a store's test asserts the list is empty.
 */
import type { TaskRepository } from "../src/application/ports.ts";
import type { Task } from "../src/domain/task.ts";

const task = (id: string, title: string): Task => ({
  id,
  title,
  status: "todo",
  createdAt: "2026-01-02T03:04:05.006Z",
  updatedAt: "2026-01-02T03:04:06.006Z",
});

type Case = [name: string, run: (newRepository: () => TaskRepository) => Promise<string | undefined>];

const CASES: Case[] = [
  [
    "a saved task is got back as it was saved",
    async (newRepository) => {
      const repository = newRepository();
      const saved = task("a", "first");
      await repository.save(saved);
      const got = await repository.get("a");
      return JSON.stringify(got) === JSON.stringify(saved) ? undefined : `got ${JSON.stringify(got)}, saved ${JSON.stringify(saved)}`;
    },
  ],
  [
    "a task never saved is not found",
    async (newRepository) => ((await newRepository().get("missing")) === undefined ? undefined : "found a task that was never saved"),
  ],
  [
    "an empty store lists nothing",
    async (newRepository) => {
      const listed = await newRepository().list();
      return listed.length === 0 ? undefined : `listed ${listed.length} tasks`;
    },
  ],
  [
    "tasks are listed oldest first, and a task saved again keeps its place",
    async (newRepository) => {
      const repository = newRepository();
      for (const saved of [task("a", "first"), task("b", "second"), task("c", "third"), task("a", "first, renamed")])
        await repository.save(saved);
      const listed = (await repository.list()).map((t) => `${t.id}=${t.title}`).join(", ");
      return listed === "a=first, renamed, b=second, c=third" ? undefined : `listed ${listed}, want a (renamed), b, c`;
    },
  ],
  [
    "two stores share nothing",
    async (newRepository) => {
      const [first, second] = [newRepository(), newRepository()];
      await first.save(task("a", "only in the first"));
      return (await second.get("a")) === undefined ? undefined : "the second store finds a task saved in the first";
    },
  ],
];

/** Every way the stores `newRepository` returns differ from the port's contract; each call must return an empty store of its own. */
export async function checkTaskRepository(newRepository: () => TaskRepository): Promise<string[]> {
  const problems: string[] = [];
  for (const [name, run] of CASES) {
    const problem = await run(newRepository);
    if (problem !== undefined) problems.push(`${name}: ${problem}`);
  }
  return problems;
}
