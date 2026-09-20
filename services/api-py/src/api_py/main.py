"""The composition root: read configuration, choose the adapters, serve until asked to stop.

This is the only module that may import from every layer, and the only one that reads the clock, the
environment or a random source. Everything below it receives what it needs.

The development server is the standard library's. ``app`` is an ordinary WSGI application, so
production deployment is ``gunicorn --pythonpath src 'api_py.main:app'`` (or waitress on Windows) with no code change.
"""

from __future__ import annotations

import json
import os
import secrets
import signal
import socketserver
import sys
import threading
from datetime import UTC, datetime
from types import FrameType
from typing import Any
from wsgiref.simple_server import WSGIRequestHandler, WSGIServer, make_server

from api_py.adapters.http import create_app
from api_py.adapters.memory_task_repository import MemoryTaskRepository
from api_py.application.task_service import TaskService
from api_py.config import Config, ConfigError, load_config


def log(entry: dict[str, object]) -> None:
    """One JSON object per line, on stdout, like api-go's slog handler."""
    print(json.dumps(entry), flush=True)


class SystemClock:
    def now(self) -> str:
        # RFC 3339 with a Z, which is what the other two services emit.
        return datetime.now(UTC).isoformat().replace("+00:00", "Z")


class RandomIds:
    def next(self) -> str:
        return secrets.token_hex(8)


class _ThreadingWSGIServer(socketserver.ThreadingMixIn, WSGIServer):
    """One thread per connection; shutdown waits for them, bounded by SHUTDOWN_TIMEOUT."""

    daemon_threads = False
    block_on_close = True


class _QuietHandler(WSGIRequestHandler):
    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002 - the base class names it
        log({"level": "info", "msg": "request", "detail": format % args})


def build_app(service: TaskService | None = None) -> Any:
    """The wiring, without the server, so a production WSGI server can import it."""
    resolved = service or TaskService(repository=MemoryTaskRepository(), clock=SystemClock(), ids=RandomIds())
    return create_app(resolved, log)


app = build_app()


def serve(config: Config) -> None:
    server = make_server("", config.port, app, server_class=_ThreadingWSGIServer, handler_class=_QuietHandler)
    stopping = threading.Event()

    def stop(_signum: int, _frame: FrameType | None) -> None:
        if stopping.is_set():
            return
        stopping.set()
        log({"level": "info", "msg": "shutting down"})
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)

    log({"level": "info", "msg": "listening", "port": config.port})
    server.serve_forever()

    # server_close waits for in-flight requests; the timeout bounds how long, as it does in api-go.
    closing = threading.Thread(target=server.server_close, daemon=True)
    closing.start()
    closing.join(config.shutdown_timeout_ms / 1000)
    if closing.is_alive():
        log({"level": "warn", "msg": "shutdown timed out with requests still in flight"})


def run() -> int:
    try:
        config = load_config(os.environ)
    except ConfigError as err:
        print(f"api-py: {err}", file=sys.stderr)
        return 2
    serve(config)
    return 0


if __name__ == "__main__":
    raise SystemExit(run())
