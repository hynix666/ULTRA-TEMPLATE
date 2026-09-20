import { useEffect, useState, type FormEvent } from "react";
import { createTask, listTasks, moveTask } from "../api.ts";
import { LABELS, nextStatuses, type Status, type Task } from "../model.ts";

export function TaskBoard() {
  const [tasks, setTasks] = useState<readonly Task[]>([]);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);

  function run(action: () => Promise<void>): void {
    setError(null);
    action().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }

  async function refresh(): Promise<void> {
    setTasks(await listTasks());
  }

  useEffect(() => run(refresh), []);

  function create(event: FormEvent): void {
    event.preventDefault();
    run(async () => {
      await createTask(title);
      setTitle("");
      await refresh();
    });
  }

  function move(task: Task, status: Status): void {
    run(async () => {
      await moveTask(task.id, status);
      await refresh();
    });
  }

  return (
    <section>
      <form onSubmit={create}>
        <input
          aria-label="Task title"
          maxLength={200}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="What needs doing?"
          value={title}
        />
        <button type="submit">Add</button>
      </form>
      {error !== null && <p role="alert">{error}</p>}
      <ul>
        {tasks.map((task) => (
          <li key={task.id}>
            <span>{task.title}</span>
            <em>{LABELS[task.status]}</em>
            {nextStatuses(task.status).map((status) => (
              <button key={status} onClick={() => move(task, status)} type="button">
                {LABELS[status]}
              </button>
            ))}
          </li>
        ))}
      </ul>
    </section>
  );
}
