from __future__ import annotations

from collections.abc import Iterable
from typing import Any

import pytest

from api_py.adapters.http import StartResponse
from api_py.adapters.request_log import with_request_log


def run(sent: str | None, status: str = "409 Conflict") -> tuple[list[tuple[str, str]], list[dict[str, object]]]:
    """One request through the wrapper, with a clock that advances 1.5 ms per reading."""
    logged: list[dict[str, object]] = []
    readings = iter([1.0, 1.0015])

    def inner(_environ: dict[str, Any], start_response: StartResponse) -> Iterable[bytes]:
        start_response(status, [("Content-Type", "application/json")])
        return [b"{}"]

    headers: list[tuple[str, str]] = []

    def start_response(_status: str, response_headers: list[tuple[str, str]]) -> None:
        headers.extend(response_headers)

    environ: dict[str, Any] = {
        "REQUEST_METHOD": "PATCH",
        "PATH_INFO": "/api/tasks/t1/status",
        "QUERY_STRING": "x=secret",
    }
    if sent is not None:
        environ["HTTP_X_REQUEST_ID"] = sent
    app = with_request_log(inner, logged.append, lambda: next(readings), lambda: "generated-1")
    assert list(app(environ, start_response)) == [b"{}"]
    return headers, logged


def test_a_usable_request_id_is_echoed_and_the_request_logged_once() -> None:
    headers, logged = run("abc-123.X_y")
    assert ("X-Request-Id", "abc-123.X_y") in headers
    assert logged == [
        {
            "level": "info",
            "msg": "request",
            "method": "PATCH",
            "path": "/api/tasks/t1/status",
            "status": 409,
            "durationMs": 1.5,
            "requestId": "abc-123.X_y",
        }
    ]


@pytest.mark.parametrize("sent", [None, "has space", "new\nline", "a" * 129])
def test_a_missing_or_unsafe_request_id_is_replaced(sent: str | None) -> None:
    headers, logged = run(sent, "200 OK")
    assert ("X-Request-Id", "generated-1") in headers
    assert logged[0]["requestId"] == "generated-1"
    assert logged[0]["status"] == 200
