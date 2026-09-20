import { requestJson } from "../../lib/http.ts";
import { parseTasks, type Status, type Task } from "./model.ts";

export async function listTasks(): Promise<Task[]> {
  return parseTasks(await requestJson("/api/tasks"));
}

export async function createTask(title: string): Promise<void> {
  await requestJson("/api/tasks", { method: "POST", body: { title } });
}

export async function moveTask(id: string, status: Status): Promise<void> {
  await requestJson(`/api/tasks/${encodeURIComponent(id)}/status`, { method: "PATCH", body: { status } });
}
