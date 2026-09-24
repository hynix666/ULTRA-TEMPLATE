/**
 * The task rules, checked in every module that repeats them without serving HTTP.
 *
 * The MCP server, the web app and the library each carry their own copy of which statuses exist and
 * which moves are legal, so each can be deleted or kept alone (ADR-0004). A copy that drifts is
 * confident and wrong: the web app offers a move the API refuses, or the MCP server tells a model a
 * move is illegal that the API would take. So the rules are stated once, in
 * scripts/rules/task-rules.json, and each module is held to that statement: this runs the module's own
 * `rules` script, which prints the module's table as JSON, and compares it key by key. No module is
 * imported from outside its directory. The task services are held to the same file through the move
 * cases of the HTTP contract (test/check-contract.test.mjs).
 *
 *   node scripts/check-rules.mjs              # every such module present
 *   node scripts/check-rules.mjs web          # one
 *
 * Exit 0 every module agrees · 1 a module disagrees · 2 a module could not be asked, or a name is not a
 * module that carries the rules.
 */
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { presentModules, ROOT, run } from "./modules.mjs";
import { loadRules } from "./rules/load.mjs";

export const RULE_MODULES = ["mcp-server", "web", "ts-library"];
/** What every module must state. A module that validates no titles leaves out maxTitleLength. */
const REQUIRED = ["statuses", "transitions"];

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sorted = (list) => [...list].sort();

/**
 * Every way `actual` differs from `expected`, or an empty list. Statuses are compared in order, since the
 * order is the lifecycle a person reads; the moves from each status are compared as a set, since the
 * order they are listed in is not a rule.
 */
export function compareRules(expected, actual) {
  if (actual === null || typeof actual !== "object" || Array.isArray(actual)) return ["did not print a JSON object"];
  const problems = [];
  for (const key of REQUIRED) if (!(key in actual)) problems.push(`does not state \`${key}\``);
  for (const key of Object.keys(actual)) if (!(key in expected)) problems.push(`states \`${key}\`, which the rules do not have`);
  if ("statuses" in actual && !same(actual.statuses, expected.statuses)) {
    problems.push(`statuses are ${JSON.stringify(actual.statuses)}, expected ${JSON.stringify(expected.statuses)}`);
  }
  if ("transitions" in actual) {
    const moves = actual.transitions ?? {};
    for (const [from, to] of Object.entries(expected.transitions)) {
      if (!Array.isArray(moves[from])) problems.push(`states no moves from \`${from}\``);
      else if (!same(sorted(moves[from]), sorted(to))) problems.push(`moves from \`${from}\` are ${JSON.stringify(moves[from])}, expected ${JSON.stringify(to)}`);
    }
    for (const from of Object.keys(moves)) if (!(from in expected.transitions)) problems.push(`states moves from \`${from}\`, which is not a status`);
  }
  if ("maxTitleLength" in actual && actual.maxTitleLength !== expected.maxTitleLength) {
    problems.push(`maxTitleLength is ${JSON.stringify(actual.maxTitleLength)}, expected ${expected.maxTitleLength}`);
  }
  return problems;
}

/** Asks a module for its rules. Returns the parsed table, or throws with the reason it could not. */
function ask(module) {
  const { status, stdout } = run("npm", ["run", "--silent", "rules"], { cwd: join(ROOT, module.dir), capture: true });
  if (status !== 0) throw new Error(`\`npm run rules\` exited ${status}`);
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error(`\`npm run rules\` printed something other than JSON: ${stdout.trim().slice(0, 80)}`);
  }
}

function main() {
  const requested = process.argv.slice(2);
  const present = presentModules().filter((m) => RULE_MODULES.includes(m.id));
  const unknown = requested.filter((id) => !present.some((m) => m.id === id));
  if (unknown.length > 0) {
    console.error(`check-rules: ${unknown.join(", ")} is not a module present here that carries the task rules. Present: ${present.map((m) => m.id).join(", ") || "none"}.`);
    return 2;
  }
  const targets = requested.length > 0 ? present.filter((m) => requested.includes(m.id)) : present;
  const rules = loadRules();
  let code = 0;
  for (const module of targets) {
    let actual;
    try {
      actual = ask(module);
    } catch (err) {
      console.error(`check-rules: cannot ask ${module.id} for its rules: ${err.message}`);
      code = 2;
      continue;
    }
    const problems = compareRules(rules, actual);
    if (problems.length > 0) {
      console.error(`check-rules: ${module.id} states the task rules differently from scripts/rules/task-rules.json\n`);
      for (const problem of problems) console.error(`  ${module.id} ${problem}`);
      code = Math.max(code, 1);
    } else {
      console.log(`check-rules: ${module.id} states the task rules as scripts/rules/task-rules.json does.`);
    }
  }
  return code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
