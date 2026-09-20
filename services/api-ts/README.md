# api-ts

The task HTTP service in TypeScript, with the same API, status codes and configuration as `api-go`. Node 24 runs the `.ts` sources directly, so there is no build step and no runtime dependency.

```text
src/domain/        pure rules over plain data — no I/O, clock, randomness or packages
src/application/   use cases, and the ports they need (TaskRepository, Clock, IdGenerator)
src/adapters/      HTTP transport and the in-memory repository
src/config.ts      environment configuration, validated at startup
src/main.ts        composition root: the only place concrete adapters are chosen
```

`scripts/check-boundaries.mjs` enforces the direction of those dependencies over every file with an allowlist per layer, and its tests prove each rule can fire.

## Run

```bash
npm install
npm start
curl -s localhost:8080/api/tasks -d '{"title":"ship it"}'
```

`PORT` (default `8080`) and `SHUTDOWN_TIMEOUT` (default `10s`; Go duration syntax, such as `1m30s`, `.5s` or `500ms`) configure it, with the same rules as the other services in this template.

## API

| Method and path | Result |
|---|---|
| `GET /healthz` | `200 {"status":"ok"}` |
| `GET /api/tasks` | `200` every task, oldest first |
| `POST /api/tasks` `{"title"}` | `201` the task · `422` invalid title |
| `GET /api/tasks/{id}` | `200` the task · `404` |
| `PATCH /api/tasks/{id}/status` `{"status"}` | `200` · `409` transition not allowed · `422` unknown status |

Bodies are capped at 1 MiB and unknown fields are rejected with `400`. `HEAD` is answered wherever `GET` is. A missing or `null` title reads as empty (`422`); a title of another type, an empty body and a malformed path are refused as malformed (`400`). Every error is JSON, `{"error": "…"}`. The cases in [`scripts/contract/tasks-api.json`](../../scripts/contract/tasks-api.json) are the contract every task service keeps, and `node scripts/check-contract.mjs` holds this one to them. This module keeps its own copy of the table so it stays readable, and removable, on its own.

## Check

```bash
npm run verify        # boundaries, typecheck, tests
docker build -t api-ts .
```

`tsc` only type-checks. Keep to syntax Node can strip (`erasableSyntaxOnly` enforces it): no `enum`, no `namespace`, no constructor parameter properties.
