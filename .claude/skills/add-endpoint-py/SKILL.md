---
name: add-endpoint-py
description: Add or change an HTTP endpoint in services/api-py across its domain, application and adapter layers, with tests at each layer. Use when a task needs a new route, request field, domain rule or status code in the Python service.
---

# Add an endpoint to api-py

Work from the inside out and run `uv run pytest` in `services/api-py` after each step.

1. **Domain** (`src/api_py/domain`) — add the rule as a pure function over frozen dataclasses. Raise a `DomainError` with a new code if the operation can fail on domain grounds. No I/O, no clock, no randomness: ids and timestamps arrive as arguments, and only the pure standard-library modules in `scripts/check_boundaries.py`'s allowlist may be imported. Test it in `tests/test_domain.py`, including every refusal.
2. **Application** (`src/api_py/application`) — add a method on `TaskService`. If it needs storage the `TaskRepository` port does not offer, extend the `Protocol` in `ports.py` and implement it in `src/api_py/adapters/memory_task_repository.py`. The adapter never imports the port: it satisfies it by shape, and a type annotation in the test is what proves it still does.
3. **Adapter** (`src/api_py/adapters/http.py`) — add the route in `_route`. Read bodies with `_read_object`, passing the fields the endpoint accepts, and map any new `DomainError` code in `STATUS_BY_CODE`; `tests/test_http.py` fails until every code has a status. Add cases for success and every refusal, driving the WSGI application directly — no socket, no port.
4. **Composition root** — only `src/api_py/main.py` chooses adapters or reads the environment.
5. **Check** — `node scripts/verify.mjs py-service` runs ruff, the formatter, strict mypy, pytest and the boundary check. If the boundary check fails, a layer imported something outside its allowlist: move the code, do not widen the allowlist.
6. **Keep the contract in step** — update the API table in `services/api-py/README.md`. Every task service in this repository must answer every route with the same status codes, so make the same change in each of the others, table included; each module keeps its own copy so it stays readable when the others are not selected. If the endpoint changes who depends on whom, update `architecture/model/system.c4` when it exists.
