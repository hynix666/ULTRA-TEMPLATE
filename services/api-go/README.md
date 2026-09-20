# api-go

A task HTTP service in Go, organised in Clean Architecture layers and built on the standard library alone.

```text
cmd/api/                  entry point: configuration, signals, listener
internal/entity/          domain model and rules — no I/O, imports nothing from this module
internal/usecase/         application logic and the ports it needs (TaskRepository)
internal/repo/memory/     a TaskRepository kept in memory
internal/controller/httpapi/  HTTP transport: decode, call a use case, map errors to status codes
internal/config/          environment configuration, validated at startup
internal/app/             composition root: the only place concrete implementations are chosen
```

Dependencies point inwards. `internal/architecture_test.go` parses every production file and fails `go test` when a layer imports something it must not, so the rule holds without a linter and without review catching it.

## Run

```bash
go run ./cmd/api
curl -s localhost:8080/api/tasks -d '{"title":"ship it"}'
```

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | Listen port, 1–65535 |
| `SHUTDOWN_TIMEOUT` | `10s` | How long in-flight requests may finish after SIGINT or SIGTERM |

## API

| Method and path | Result |
|---|---|
| `GET /healthz` | `200 {"status":"ok"}` |
| `GET /api/tasks` | `200` every task, oldest first |
| `POST /api/tasks` `{"title"}` | `201` the task · `422` invalid title |
| `GET /api/tasks/{id}` | `200` the task · `404` |
| `PATCH /api/tasks/{id}/status` `{"status"}` | `200` · `409` transition not allowed · `422` unknown status |

Bodies are capped at 1 MiB and unknown fields are rejected with `400`. `HEAD` is answered wherever `GET` is. A missing or `null` title reads as empty (`422`); a title of another type, an empty body and a malformed path are refused as malformed (`400`). Every error is JSON, `{"error": "…"}`. The cases in [`scripts/contract/tasks-api.json`](../../scripts/contract/tasks-api.json) are the contract every task service keeps, and `node scripts/check-contract.mjs` holds this one to them.

## Check

```bash
gofmt -l . && go vet ./... && go test -race ./... && golangci-lint run
docker build -t api-go .
```

To add a store, implement `usecase.TaskRepository` in a new package under `internal/repo/` and choose it in `internal/app`. The memory repository's tests describe the behaviour a store must match.
