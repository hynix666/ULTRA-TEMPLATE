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
export const TASK_SERVICES = ["go-service", "ts-service", "py-service"];
const STARTUP_MS = 60_000;

export const loadCases = (file = CASES_FILE) => JSON.parse(readFileSync(file, "utf8")).cases;

/** A body is a string sent as written, or an object whose `{ repeat, times }` values are expanded first. */
export function encodeBody(body) {
  if (body === undefined || typeof body === "string") return body;
  const expand = (value) =>
    value !== null && typeof value === "object" && "repeat" in value ? value.repeat.repeat(value.times) : value;
  return JSON.stringify(Object.fromEntries(Object.entries(body).map(([key, value]) => [key, expand(value)])));
}

function send(base, { method, path, body, contentType = "application/json" }) {
  const url = new URL(base);
  const payload = encodeBody(body);
  const headers = payload === undefined ? {} : { "content-type": contentType, "content-length": Buffer.byteLength(payload) };
  return new Promise((resolve, reject) => {
    // node:http rather than fetch: fetch refuses a body on some methods and normalizes the path.
    const req = request({ host: url.hostname, port: url.port, method, path, headers }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, type: String(res.headers["content-type"] ?? ""), text: Buffer.concat(chunks).toString("utf8") }));
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
    if (keys !== "createdAt,id,status,title,updatedAt") problems.push(`task fields ${keys}`);
    for (const [key, value] of Object.entries(testCase.task)) {
      if (body?.[key] !== value) problems.push(`${key} ${JSON.stringify(body?.[key])}, expected ${JSON.stringify(value)}`);
    }
  }
  if ((testCase.error || testCase.array || testCase.json || testCase.task) && !answer.type.startsWith("application/json")) {
    problems.push(`content-type ${answer.type || "missing"}`);
  }
  return problems;
}

/** Runs every case against a service already listening at `base`. Returns the mismatches. */
export async function runCases(base, cases) {
  const failures = [];
  for (const testCase of cases) {
    let path = testCase.path;
    if (path.includes("{id}")) {
      const created = await send(base, { method: "POST", path: "/api/tasks", body: '{"title":"contract"}' });
      const id = parse(created.text)?.id;
      if (created.status !== 201 || typeof id !== "string") {
        failures.push({ name: testCase.name, problems: [`could not create the task this case needs (${created.status})`] });
        continue;
      }
      path = path.replace("{id}", encodeURIComponent(id));
    }
    let answer;
    try {
      answer = await send(base, { ...testCase, path });
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
      stdio: ["ignore", "ignore", "pipe"],
      detached: process.platform !== "win32",
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", (err) => (stderr += String(err)));
    try {
      if (!(await waitForHealth(base, child))) return { module, fatal: `did not answer /healthz within ${STARTUP_MS / 1000}s. ${stderr.trim().slice(-400)}` };
      return { module, failures: await runCases(base, cases) };
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
