/**
 * Every module's checks, locally, as CI runs them. Workflow linting, image builds and the security scans
 * run only in CI.
 *
 *   node scripts/verify.mjs                  # the chassis and every module present
 *   node scripts/verify.mjs go-service web   # the chassis and only the modules named
 *   node scripts/verify.mjs web --no-chassis # one module alone, as its CI job runs it
 *   node scripts/verify.mjs --dry-run        # what would run, one tab-separated line per step
 *
 * The checks are each module's own, from its module.json: the CI job of a module runs this same
 * script over the same manifest, so local runs and CI cannot drift apart (ADR-0014).
 *
 * A step that cannot run FAILS. A check that quietly does not run reads exactly like one that
 * passed, so a missing toolchain or missing dependencies is a red line with the fix in it, and so is a
 * Node whose major version differs from .node-version. The exceptions are declared, never guessed: a
 * check whose manifest names a `tool` that is not on PATH, or `requires` a condition this machine lacks
 * (Go's race detector needs cgo and a C compiler), is reported as SKIPPED by name, and the module's CI
 * job, which has both, always runs it.
 *
 * Exit 0 everything passed · 1 something failed · 2 a module name that is unknown or not present.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { available, checkNodeVersion, ModuleError, presentModules, REQUIREMENTS, ROOT, run, TOOLCHAINS } from "./modules.mjs";

const { values: flags, positionals: requested } = parseArgs({
  allowPositionals: true,
  options: { "no-chassis": { type: "boolean" }, "dry-run": { type: "boolean" } },
});

const results = [];
const record = (name, status, note = "") => results.push({ name, status, note });

function step(name, [command, ...args], cwd = ROOT) {
  if (flags["dry-run"]) {
    console.log(`${name}\t${cwd === ROOT ? "." : cwd.slice(ROOT.length + 1).split("\\").join("/")}\t${[command, ...args].join(" ")}`);
    return;
  }
  console.log(`\n▶ ${name}`);
  const { status } = run(command, args, { cwd });
  record(name, status === 0 ? "pass" : "fail", status === 0 ? "" : `exit ${status}`);
}

function chassis() {
  // Every check below runs on this Node; on another major than CI's, a pass predicts nothing.
  const wrongNode = checkNodeVersion();
  record("chassis: node version", wrongNode === null ? "pass" : "fail", wrongNode ?? "");
  step("chassis: hygiene", ["node", "scripts/check-hygiene.mjs"]);
  step("chassis: docs", ["node", "scripts/check-docs.mjs"]);
  const suites = ["test/*.test.mjs"];
  if (existsSync(join(ROOT, "template"))) suites.push("template/*.test.mjs");
  step("chassis: tests", ["node", "--test", ...suites]);
}

/** Runs one check from a module's manifest, as the manifest says: its command, and when it may be skipped. */
function check(module, cwd, spec) {
  const name = `${module.id}: ${spec.name}`;
  if (spec.requires !== undefined && !flags["dry-run"] && !REQUIREMENTS[spec.requires](cwd)) {
    if (spec.otherwise) step(`${module.id}: ${spec.otherwise.name}`, spec.otherwise.run, cwd);
    record(name, "skipped", `needs ${spec.requires}; the ${module.id} CI job runs it`);
    return;
  }
  if (spec.tool !== undefined && !flags["dry-run"] && !available(spec.tool, ["--version"])) {
    record(name, "skipped", `${spec.tool} is not on PATH; the ${module.id} CI job runs it`);
    return;
  }
  if (spec.expect === "no-output" && !flags["dry-run"]) {
    // A command that reports findings on stdout and still exits 0, such as gofmt -l.
    const [command, ...args] = spec.run;
    const out = run(command, args, { cwd, capture: true });
    const findings = out.stdout.trim().split(/\r?\n/).filter(Boolean);
    record(name, out.status === 0 && findings.length === 0 ? "pass" : "fail", findings.join(", "));
    return;
  }
  step(name, spec.run, cwd);
}

function verifyModule(module) {
  const cwd = join(ROOT, module.dir);
  const toolchain = TOOLCHAINS[module.toolchain];
  if (!flags["dry-run"]) {
    if (!available(toolchain.command, toolchain.probe)) {
      record(`${module.id}: toolchain`, "fail", `${toolchain.command} is not on PATH; install it or remove the module`);
      return;
    }
    if (toolchain.installed && !existsSync(join(cwd, toolchain.installed))) {
      record(`${module.id}: dependencies`, "fail", "not installed; run node scripts/setup.mjs");
      return;
    }
  }
  for (const spec of module.checks) check(module, cwd, spec);
  // A task service is held to the one contract all of them share (ADR-0008), and a module that repeats
  // facts without serving them to the files that state them (ADR-0010).
  if (module.taskApi) step(`${module.id}: contract`, ["node", "scripts/check-contract.mjs", module.id]);
  if (module.facts) step(`${module.id}: facts`, ["node", "scripts/check-facts.mjs", module.id]);
}

let present;
try {
  present = presentModules();
} catch (err) {
  if (!(err instanceof ModuleError)) throw err;
  console.error(`verify: ${err.message}`);
  process.exit(2);
}
const absent = requested.filter((id) => !present.some((m) => m.id === id));
if (absent.length > 0) {
  // Naming a module that is not here must not print OK after checking only the chassis.
  console.error(`verify: no module named ${absent.join(", ")} here. Present: ${present.map((m) => m.id).join(", ") || "none"}.`);
  process.exit(2);
}

if (!flags["no-chassis"]) chassis();
for (const module of present) {
  if (requested.length === 0 || requested.includes(module.id)) verifyModule(module);
}

if (flags["dry-run"]) process.exit(0);
const icon = { pass: "✔", fail: "✘", skipped: "–" };
console.log("\nverify summary");
for (const { name, status, note } of results) console.log(`  ${icon[status]} ${name}${note ? `  (${note})` : ""}`);
const failed = results.filter((r) => r.status === "fail").length;
console.log(failed === 0 ? "\nverify: OK" : `\nverify: ${failed} step(s) failed`);
process.exitCode = failed === 0 ? 0 : 1;
