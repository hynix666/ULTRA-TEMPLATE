/**
 * The task API contract, checked against each task service over HTTP.
 *
 * The services are the same API in three languages, and "identical behaviour" is the claim the whole
 * structure rests on (ADR-0008). Each service's own tests were written separately, and they drifted:
 * the first run of this check found six requests the services answered differently. So the cases
 * live once, in scripts/contract/tasks-api.json, and every service is held to them — not to each
 * other, so a project that keeps only one service still checks it.
 *
 * It talks to a service only over HTTP, the one way modules may integrate (ADR-0004): it starts the
 * service on a free port, waits for /healthz, sends every case, and stops it.
 *
 *   node scripts/check-contract.mjs              # every task service present
 *   node scripts/check-contract.mjs py-service   # one
 *
 * Exit 0 every case matched · 1 a service answered differently · 2 a service could not be started,
 * or a name is not a task service present here.
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { request } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { presentModules, ROOT } from "./modules.mjs";

export const CASES_FILE = join(ROOT, "scripts", "contract", "tasks-api.json");
export const SPEC_FILE = join(ROOT, "scripts", "contract", "openapi.json");
/** The fields of a task, as every service answers with them and the OpenAPI document states them. */
export const TASK_FIELDS = ["createdAt", "id", "status", "title", "updatedAt"];
export const TASK_SERVICES = ["go-service", "ts-service", "py-service"];
const STARTUP_MS = 60_000;
const LOG_WAIT_MS = 3_000;

export const loadCases = (file = CASES_FILE) => JSON.parse(readFileSync(file, "utf8")).cases;
export const loadSpec = (file = SPEC_FILE) => JSON.parse(readFileSync(file, "utf8"));

/** Follows a local `$ref` such as `#/components/schemas/Task`. */
const deref = (spec, node) => (node?.$ref ? node.$ref.slice(2).split("/").reduce((at, key) => at?.[key], spec) : node);

/**
 * Where the OpenAPI document and the contract disagree, or an empty list. The document is a
 * description of the API that clients can read; the cases are what every service is proved against. So
 * each is held to the other: every case sent to a documented operation answers with a status the
 * document lists, every listed response is exercised by a case, a method a documented path does not
 * list is answered 405, and the schemas state the fields the services answer with and the statuses and
 * title length of scripts/rules/task-rules.json.
 */
export function checkSpec(spec, cases, rules) {
  const problems = [];
  const templates = Object.keys(spec.paths ?? {});
  const template = (path) => {
    const segments = path.split("?")[0].split("/");
    return templates.find((t) => {
      const parts = t.split("/");
      return parts.length === segments.length && parts.every((part, i) => (/^\{.+\}$/.test(part) ? segments[i] !== "" : part === segments[i]));
    });
  };
  const exercised = new Set();
  for (const c of cases) {
    const path = template(c.path);
    if (path === undefined) continue; // outside the API: answered 404, which the document says of any path
    const method = c.method === "HEAD" ? "get" : c.method.toLowerCase();
    const operation = spec.paths[path][method];
    if (operation === undefined) {
      if (c.status !== 405) problems.push(`case "${c.name}" sends ${c.method} to ${path}, which the document does not list, and expects ${c.status} rather than 405`);
    } else if (!(String(c.status) in operation.responses)) {
      problems.push(`case "${c.name}": ${c.method} ${path} answers ${c.status}, which the document does not list`);
    } else {
      exercised.add(`${method} ${path} ${c.status}`);
    }
  }
  for (const path of templates) {
    for (const [method, operation] of Object.entries(spec.paths[path])) {
      for (const code of Object.keys(operation?.responses ?? {})) {
        if (!exercised.has(`${method} ${path} ${code}`)) problems.push(`the document lists ${code} for ${method.toUpperCase()} ${path}, which no case exercises`);
      }
    }
  }
  const schemas = spec.components?.schemas ?? {};
  const fields = Object.keys(schemas.Task?.properties ?? {}).sort().join(",");
  if (fields !== TASK_FIELDS.join(",")) problems.push(`the Task schema has fields ${fields}, expected ${TASK_FIELDS.join(",")}`);
  const statuses = deref(spec, schemas.Task?.properties?.status)?.enum;
  if (JSON.stringify(statuses) !== JSON.stringify(rules.statuses)) {
    problems.push(`the Status enum is ${JSON.stringify(statuses)}, expected ${JSON.stringify(rules.statuses)}`);
  }
  for (const [name, title] of [["Task", schemas.Task?.properties?.title], ["CreateTask", schemas.CreateTask?.properties?.title]]) {
    if (title?.maxLength !== rules.maxTitleLength) problems.push(`the ${name} title maxLength is ${title?.maxLength}, expected ${rules.maxTitleLength}`);
  }
  return problems;
}

/** What a service may echo as a request id; anything else it replaces with one of its own. */
export const REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

const expand = (value) => (value !== null && typeof value === "object" && "repeat" in value ? value.repeat.repeat(value.times) : value);

/** A body is a string sent as written, or an object whose `{ repeat, times }` values are expanded first. */
export function encodeBody(body) {
  if (body === undefined || typeof body === "string") return body;
  return JSON.stringify(Object.fromEntries(Object.entries(body).map(([key, value]) => [key, expand(value)])));
}

/** A case's headers, with `{ repeat, times }` values expanded as in a body. */
const encodeHeaders = (headers = {}) => Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, expand(value)]));

function send(base, { method, path, body, headers: extra, contentType = "application/json" }) {
  const url = new URL(base);
  const payload = encodeBody(body);
  const headers = { ...encodeHeaders(extra), ...(payload === undefined ? {} : { "content-type": contentType, "content-length": Buffer.byteLength(payload) }) };
  return new Promise((resolve, reject) => {
    // node:http rather than fetch: fetch refuses a body on some methods and normalizes the path.
    const req = request({ host: url.hostname, port: url.port, method, path, headers }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () =>
        resolve({
          status: res.statusCode,
          type: String(res.headers["content-type"] ?? ""),
          requestId: res.headers["x-request-id"],
          text: Buffer.concat(chunks).toString("utf8"),
        }),
      );
    });
    req.on("error", reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

const parse = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/** What is wrong with one answer, or an empty list. */
export function judge(testCase, answer) {
  const problems = [];
  if (answer.status !== testCase.status) problems.push(`status ${answer.status}, expected ${testCase.status}`);
  const body = parse(answer.text);
  if (testCase.error && typeof body?.error !== "string") problems.push(`no {"error": "..."} body: ${answer.text.slice(0, 80)}`);
  if (testCase.array && !Array.isArray(body)) problems.push("body is not a JSON array");
  if (testCase.json && JSON.stringify(body) !== JSON.stringify(testCase.json)) problems.push(`body ${answer.text.slice(0, 80)}`);
  if (testCase.task) {
    const keys = Object.keys(body ?? {}).sort().join(",");
    if (keys !== TASK_FIELDS.join(",")) problems.push(`task fields ${keys}`);
    for (const [key, value] of Object.entries(testCase.task)) {
      if (body?.[key] !== value) problems.push(`${key} ${JSON.stringify(body?.[key])}, expected ${JSON.stringify(value)}`);
    }
  }
  if ((testCase.error || testCase.array || testCase.json || testCase.task) && !answer.type.startsWith("application/json")) {
    problems.push(`content-type ${answer.type || "missing"}`);
  }
  // The language's own server may refuse a request before the service sees it, and then only it answers.
  if (!testCase.beforeService && !REQUEST_ID.test(answer.requestId ?? "")) problems.push("no usable X-Request-Id header");
  const sent = expand(Object.entries(testCase.headers ?? {}).find(([key]) => key.toLowerCase() === "x-request-id")?.[1]);
  if (testCase.requestId === "echo" && answer.requestId !== sent) {
    problems.push(`X-Request-Id ${JSON.stringify(answer.requestId)}, expected the ${JSON.stringify(sent)} that was sent`);
  }
  if (testCase.requestId === "replaced" && answer.requestId === sent) problems.push(`X-Request-Id echoes ${JSON.stringify(sent)}, which is not a usable id`);
  return problems;
}

/**
 * Where the service's stdout disagrees with the requests it answered, or an empty list. Every line is
 * JSON, and every answered request with an id is logged exactly once, with the method, the path without
 * its query string and the status it was answered with, a non-negative durationMs, a parseable time and
 * the level "info". Lines for other requests, such as the health polls at startup, are allowed.
 */
export function checkLogs(exchanges, stdout) {
  const problems = [];
  const lines = [];
  for (const text of stdout.split(/\r?\n/).filter((l) => l.trim() !== "")) {
    try {
      lines.push(JSON.parse(text));
    } catch {
      problems.push(`stdout line is not JSON: ${text.slice(0, 80)}`);
    }
  }
  const uses = new Map();
  for (const exchange of exchanges) uses.set(exchange.requestId, (uses.get(exchange.requestId) ?? 0) + 1);
  for (const [id, count] of uses) if (count > 1) problems.push(`request id ${id} was given to ${count} responses, so their log lines cannot be told apart`);
  for (const { requestId, method, path, status } of exchanges.filter((e) => uses.get(e.requestId) === 1)) {
    const logged = lines.filter((line) => line?.msg === "request" && line.requestId === requestId);
    if (logged.length !== 1) {
      problems.push(`request ${requestId} (${method} ${path}) was logged ${logged.length} times, expected once`);
      continue;
    }
    const [line] = logged;
    const wrong = [];
    if (line.method !== method) wrong.push(`method ${JSON.stringify(line.method)}, expected ${method}`);
    if (line.path !== path) wrong.push(`path ${JSON.stringify(line.path)}, expected ${path}`);
    if (line.status !== status) wrong.push(`status ${JSON.stringify(line.status)}, expected ${status}`);
    if (typeof line.durationMs !== "number" || line.durationMs < 0) wrong.push(`durationMs ${JSON.stringify(line.durationMs)}`);
    if (typeof line.time !== "string" || Number.isNaN(Date.parse(line.time))) wrong.push(`time ${JSON.stringify(line.time)}`);
    if (line.level !== "info") wrong.push(`level ${JSON.stringify(line.level)}`);
    if (wrong.length > 0) problems.push(`request ${requestId} logged ${wrong.join(", ")}`);
  }
  return problems;
}

/**
 * Runs every case against a service already listening at `base`. Returns the mismatches.
 *
 * A case may list `setup` requests, sent first to bring its task to the state the case is about, such
 * as a task already done. Each is judged on its status alone. One that does not land is reported as
 * itself and the case is not sent: a service that cannot reach a state has not answered the question
 * asked from it.
 */
export async function runCases(base, cases, exchanges = []) {
  const failures = [];
  // Every request a case sends, the ones that stage it included, is recorded for checkLogs.
  const exchange = async (request) => {
    const answer = await send(base, request);
    if (typeof answer.requestId === "string") {
      exchanges.push({ requestId: answer.requestId, method: request.method, path: request.path.split("?")[0], status: answer.status });
    }
    return answer;
  };
  for (const testCase of cases) {
    const setup = testCase.setup ?? [];
    let id;
    if ([testCase, ...setup].some((request) => request.path.includes("{id}"))) {
      const created = await exchange({ method: "POST", path: "/api/tasks", body: '{"title":"contract"}' });
      id = parse(created.text)?.id;
      if (created.status !== 201 || typeof id !== "string") {
        failures.push({ name: testCase.name, problems: [`could not create the task this case needs (${created.status})`] });
        continue;
      }
    }
    const resolve = (path) => (id === undefined ? path : path.replace("{id}", encodeURIComponent(id)));
    let staged = true;
    for (const [index, step] of setup.entries()) {
      const path = resolve(step.path);
      const answer = await exchange({ ...step, path }).catch(() => null);
      if (answer?.status !== step.status) {
        failures.push({ name: testCase.name, problems: [`setup ${index + 1} (${step.method} ${path}) answered ${answer?.status ?? "with invalid HTTP"}, expected ${step.status}`] });
        staged = false;
        break;
      }
    }
    if (!staged) continue;
    const path = resolve(testCase.path);
    let answer;
    try {
      answer = await exchange({ ...testCase, path });
    } catch (err) {
      // A response the client cannot parse — a body on a HEAD response, say — is a failed case,
      // not a crash of the check.
      failures.push({ name: testCase.name, problems: [`not valid HTTP: ${err.code ?? err.message}`] });
      continue;
    }
    const problems = judge(testCase, answer);
    if (problems.length > 0) failures.push({ name: testCase.name, problems });
  }
  return failures;
}

const freePort = () =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });

/** How each task service is started. Go is built first, so stopping it stops the server itself. */
function command(id, dir, scratch) {
  if (id === "go-service") {
    const binary = join(scratch, process.platform === "win32" ? "api.exe" : "api");
    const build = spawnSync("go", ["build", "-o", binary, "./cmd/api"], { cwd: dir, stdio: "inherit" });
    return build.status === 0 ? [binary, []] : null;
  }
  if (id === "ts-service") return ["node", ["src/main.ts"]];
  return ["uv", ["run", "--frozen", "--directory", "src", "python", "-m", "api_py.main"]];
}

function stop(child) {
  if (child.exitCode !== null) return;
  // A service can be a tree (uv starts python), and a tree has to be stopped as one.
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else process.kill(-child.pid, "SIGTERM");
}

async function waitForHealth(base, child) {
  const deadline = Date.now() + STARTUP_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) return false;
    try {
      if ((await send(base, { method: "GET", path: "/healthz" })).status === 200) return true;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

async function checkService(module, cases) {
  const scratch = mkdtempSync(join(tmpdir(), "contract-"));
  const dir = join(ROOT, module.dir);
  try {
    const cmd = command(module.id, dir, scratch);
    if (cmd === null) return { module, fatal: "did not build" };
    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;
    const child = spawn(cmd[0], cmd[1], {
      cwd: dir,
      env: { ...process.env, PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", (err) => (stderr += String(err)));
    try {
      if (!(await waitForHealth(base, child))) return { module, fatal: `did not answer /healthz within ${STARTUP_MS / 1000}s. ${stderr.trim().slice(-400)}` };
      const exchanges = [];
      const failures = await runCases(base, cases, exchanges);
      // A log line is written after its response, so give the last ones a moment to arrive.
      const deadline = Date.now() + LOG_WAIT_MS;
      while (Date.now() < deadline && checkLogs(exchanges, stdout).some((p) => p.includes("logged 0 times"))) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const logged = checkLogs(exchanges, stdout);
      // A service that logs nothing fails every request; the first few say why as well as all of them.
      const shown = logged.length > 5 ? [...logged.slice(0, 5), `and ${logged.length - 5} more`] : logged;
      if (logged.length > 0) failures.push({ name: "request log", problems: shown });
      return { module, failures };
    } finally {
      stop(child);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

async function main() {
  const requested = process.argv.slice(2);
  const present = presentModules().filter((m) => TASK_SERVICES.includes(m.id));
  const unknown = requested.filter((id) => !present.some((m) => m.id === id));
  if (unknown.length > 0) {
    console.error(`check-contract: ${unknown.join(", ")} is not a task service present here. Present: ${present.map((m) => m.id).join(", ") || "none"}.`);
    return 2;
  }
  const targets = requested.length > 0 ? present.filter((m) => requested.includes(m.id)) : present;
  if (targets.length === 0) {
    console.log("check-contract: no task service present; nothing to check.");
    return 0;
  }
  const cases = loadCases();
  let code = 0;
  for (const module of targets) {
    const result = await checkService(module, cases);
    if (result.fatal) {
      console.error(`check-contract: ${module.id} ${result.fatal}`);
      code = 2;
    } else if (result.failures.length > 0) {
      console.error(`check-contract: ${module.id} answered ${result.failures.length} of ${cases.length} case(s) differently\n`);
      for (const { name, problems } of result.failures) console.error(`  ${name}: ${problems.join("; ")}`);
      code = Math.max(code, 1);
    } else {
      console.log(`check-contract: ${module.id} matches all ${cases.length} cases.`);
    }
  }
  return code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
