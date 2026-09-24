"""One X-Request-Id and one log line per request: the same header and the same line api-go and api-ts write.

The clock and the id source are passed in by the composition root, as everywhere below it.
"""

from __future__ import annotations

import re
from collections.abc import Callable, Iterable
from typing import Any, Final

from api_py.adapters.http import Log, StartResponse, WSGIApplication

REQUEST_ID_HEADER: Final = "X-Request-Id"
# An id is copied into a response header and a log line, so one that is longer than this, or holds
# characters a log reader or a header could misread, is replaced rather than echoed.
_REQUEST_ID: Final = re.compile(r"^[A-Za-z0-9._-]{1,128}$")


def with_request_log(
    app: WSGIApplication, log: Log, monotonic: Callable[[], float], new_id: Callable[[], str]
) -> WSGIApplication:
    """Wraps ``app``. ``monotonic`` returns seconds, as ``time.monotonic`` does."""

    def logged(environ: dict[str, Any], start_response: StartResponse) -> Iterable[bytes]:
        start = monotonic()
        sent = environ.get("HTTP_X_REQUEST_ID", "")
        request_id = sent if isinstance(sent, str) and _REQUEST_ID.fullmatch(sent) else new_id()
        answered: list[int] = []

        def start_with_id(status: str, headers: list[tuple[str, str]]) -> Any:
            answered.append(int(status.split(" ", 1)[0]))
            return start_response(status, [*headers, (REQUEST_ID_HEADER, request_id)])

        body = app(environ, start_with_id)
        log(
            {
                "level": "info",
                "msg": "request",
                "method": environ.get("REQUEST_METHOD", ""),
                # PATH_INFO holds no query string, which can carry what should not be logged.
                "path": environ.get("PATH_INFO", ""),
                "status": answered[0] if answered else 500,
                "durationMs": round((monotonic() - start) * 1000, 3),
                "requestId": request_id,
            }
        )
        return body

    return logged
