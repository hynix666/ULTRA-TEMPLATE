import type { IncomingMessage, ServerResponse } from "node:http";
import type { Log } from "./http.ts";

export const REQUEST_ID_HEADER = "x-request-id";

/**
 * An id is copied into a response header and a log line, so one that is longer than this, or holds
 * characters a log reader or a header could misread, is replaced rather than echoed.
 */
const REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

export interface RequestLogOptions {
  /** Milliseconds from a monotonic clock, such as performance.now. */
  readonly monotonic: () => number;
  readonly newId: () => string;
}

type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

/**
 * Gives every response an X-Request-Id and writes one log line per request, the same line api-go and
 * api-py write. The clock and the id source are injected by the composition root.
 */
export function withRequestLog(next: Handler, log: Log, { monotonic, newId }: RequestLogOptions): Handler {
  return async (req, res) => {
    const start = monotonic();
    const sent = req.headers[REQUEST_ID_HEADER];
    const id = typeof sent === "string" && REQUEST_ID.test(sent) ? sent : newId();
    res.setHeader(REQUEST_ID_HEADER, id);
    try {
      await next(req, res);
    } finally {
      log({
        level: "info",
        msg: "request",
        method: req.method,
        path: requestPath(req.url),
        status: res.statusCode,
        durationMs: Math.round((monotonic() - start) * 1000) / 1000,
        requestId: id,
      });
    }
  };
}

/** The path without its query string, which can carry what should not be logged, percent-decoded where it can be. */
function requestPath(url: string | undefined): string {
  const path = new URL(url ?? "/", "http://localhost").pathname;
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}
