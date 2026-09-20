/**
 * The one place the app talks HTTP: JSON in and out, and a failed response turned into an Error that
 * carries the service's own `{ "error": ... }` message. Shared code: it imports nothing from a feature.
 */
export async function requestJson(path: string, options: { method?: string; body?: unknown } = {}): Promise<unknown> {
  const init: RequestInit = { method: options.method ?? "GET" };
  if (options.body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(options.body);
  }
  const res = await fetch(path, init);
  if (!res.ok) throw new Error(await errorMessage(res));
  return res.status === 204 ? undefined : res.json();
}

/** The service's `{ "error": ... }` message when there is one, otherwise the status code. */
export async function errorMessage(res: Response): Promise<string> {
  try {
    const body: unknown = await res.json();
    if (typeof body === "object" && body !== null && "error" in body && typeof body.error === "string") return body.error;
  } catch {
    // Not JSON: fall through to the status code.
  }
  return `request failed with status ${res.status}`;
}
