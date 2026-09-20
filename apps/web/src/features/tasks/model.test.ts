import { describe, expect, it } from "vitest";
import { nextStatuses, parseTasks } from "./model.ts";

describe("nextStatuses", () => {
  it("offers exactly the moves the API accepts", () => {
    expect(nextStatuses("todo")).toEqual(["in_progress"]);
    expect(nextStatuses("in_progress")).toEqual(["todo", "done"]);
    expect(nextStatuses("done")).toEqual([]);
  });
});

describe("parseTasks", () => {
  it("keeps only the fields the interface uses", () => {
    const json = [{ id: "a", title: "ship it", status: "todo", createdAt: "2026-01-01T00:00:00Z" }];
    expect(parseTasks(json)).toEqual([{ id: "a", title: "ship it", status: "todo" }]);
  });

  it("rejects a response that is not what the API documents", () => {
    expect(() => parseTasks({ tasks: [] })).toThrow(/list of tasks/);
    expect(() => parseTasks([null])).toThrow(/task 0 is not an object/);
    expect(() => parseTasks([{ id: "a", title: "x", status: "DONE" }])).toThrow(/known status/);
  });
});
