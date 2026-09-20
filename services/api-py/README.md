# api-py

The task API in Python: the same routes, the same status codes and the same configuration as `api-go` and `api-ts`, built from the same layers. Standard library only — no runtime dependencies.

`src/api_py/domain` holds the rules and is pure: no I/O, no clock, no randomness, and no imports beyond a few standard-library modules that are themselves pure. `src/api_py/application` holds the use cases and the ports they need, declared as `Protocol` classes so an adapter satisfies one by shape without importing it. `src/api_py/adapters` holds the HTTP transport and the in-memory store. `src/api_py/main.py` is the composition root and the only module that reads the environment, the clock or a random source.

`scripts/check_boundaries.py` enforces that with Python's own parser: a file in no layer fails, and so does a layer importing past its allowlist.

## Run it

```bash
uv sync --locked
uv run --directory src python -m api_py.main     # PORT=8080 by default
```

The transport is a plain WSGI application, so production is a deployment choice rather than a dependency: `uv run gunicorn --pythonpath src 'api_py.main:app'`, waitress on Windows, or anything else that speaks WSGI. The development server above is the standard library's and is fine for local work and tests.

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | TCP port, read the way Go's `strconv.Atoi` reads it |
| `SHUTDOWN_TIMEOUT` | `10s` | Go duration syntax (`10s`, `1m30s`, `500ms`); bounds how long shutdown waits for requests in flight |

A value it cannot use stops the process with exit code 2 rather than falling back to a default.

## API

| Method and path | Result |
|---|---|
| `GET /healthz` | `200 {"status":"ok"}` |
| `GET /api/tasks` | `200` every task, oldest first |
| `POST /api/tasks` `{"title"}` | `201` the task · `422` invalid title |
| `GET /api/tasks/{id}` | `200` the task · `404` |
| `PATCH /api/tasks/{id}/status` `{"status"}` | `200` · `409` transition not allowed · `422` unknown status |

Bodies are capped at 1 MiB and unknown fields are rejected with `400`. `HEAD` is answered wherever `GET` is. A missing or `null` title reads as empty (`422`); a title of another type, an empty body and a malformed path are refused as malformed (`400`). Every error is JSON, `{"error": "…"}`. The cases in [`scripts/contract/tasks-api.json`](../../scripts/contract/tasks-api.json) are the contract every task service keeps, and `node scripts/check-contract.mjs` holds this one to them.

One difference worth knowing: WSGI decodes `PATH_INFO` before a route sees it, so an id containing a percent-encoded slash only round-trips under a server that also exposes the raw target (gunicorn's `RAW_URI`), and the standard-library server collapses `//` at the start of a path before the application sees it. Generated ids never contain a slash, and non-canonical paths are outside the contract for every service.

## Check

```bash
uv run ruff check . && uv run ruff format --check .
uv run mypy
uv run pytest
uv run python scripts/check_boundaries.py
```

`node scripts/verify.mjs py-service` runs all four, after checking that `uv.lock` still matches `pyproject.toml`, and then the contract; CI runs the same. uv's own version is pinned once, in `[tool.uv] required-version`.

## Container

```bash
docker build --tag api-py .
docker run --rm -p 8080:8080 api-py
```
