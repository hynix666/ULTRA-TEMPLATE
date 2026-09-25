// Where the dev server sends /api: a task service on its default port. scripts/check-facts.mjs holds this
// port to the one the task API contract (scripts/contract/tasks-api.json) says every service listens on.
export const API_DEFAULT_PORT = 8080;

export const apiProxy = { "/api": `http://localhost:${API_DEFAULT_PORT}` };
