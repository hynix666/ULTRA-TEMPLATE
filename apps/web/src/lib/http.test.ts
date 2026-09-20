import { afterEach, describe, expect, it, vi } from "vitest";
import { errorMessage, requestJson } from "./http.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("errorMessage", () => {
  it("prefers the service's message and falls back to the status", async () => {
    expect(await errorMessage(new Response('{"error":"title must not be empty"}', { status: 422 }))).toBe("title must not be empty");
    expect(await errorMessage(new Response("<html>", { status: 502 }))).toBe("request failed with status 502");
  });
});

describe("requestJson", () => {
  it("sends a JSON body and returns the parsed response", async () => {
    const fetch = vi.fn(async () => new Response('{"id":"a"}', { status: 201 }));
    vi.stubGlobal("fetch", fetch);
    expect(await requestJson("/api/tasks", { method: "POST", body: { title: "x" } })).toEqual({ id: "a" });
    expect(fetch).toHaveBeenCalledWith("/api/tasks", { method: "POST", headers: { "content-type": "application/json" }, body: '{"title":"x"}' });
  });

  it("throws the service's message when the request fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"error":"status transition not allowed"}', { status: 409 })));
    await expect(requestJson("/api/tasks/a/status", { method: "PATCH", body: { status: "done" } })).rejects.toThrow("status transition not allowed");
  });
});
