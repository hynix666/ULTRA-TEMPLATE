/**
 * The facts a module repeats without serving them, each checked against the one file that states it.
 *
 * The MCP server, the web app and the library each carry their own copy of which statuses exist and
 * which moves are legal, and the MCP server and the web app their own idea of where the task API
 * listens, so each can be deleted or kept alone (ADR-0004). A copy that drifts is confident and wrong:
 * the web app offers a move the API refuses, or proxies to a port no service listens on. So each fact is
 * stated once — the task rules in scripts/rules/task-rules.json, the API's default port in the contract,
 * scripts/contract/tasks-api.json — and each module is held to that statement: this runs the command
 * its module.json names, which prints the module's facts as JSON, and compares them key by key. No
 * module is imported from outside its directory. The task services are held to the same files over
 * HTTP and at startup by scripts/check-contract.mjs.
 *
 *   node scripts/check-facts.mjs              # every such module present
 *   node scripts/check-facts.mjs web          # one
 *
 * Exit 0 every module agrees · 1 a module disagrees · 2 a module could not be asked, or a name is not a
 * module that repeats any fact.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { FACTS, presentModules, ROOT, run } from "./modules.mjs";
import { loadRules, RULES_FILE } from "./rules/load.mjs";

export const CONTRACT_FILE = join(ROOT, "scripts", "contract", "tasks-api.json");

/**
 * Every fact this project states, from the file that states it: the task rules, and the port a task
 * service listens on by default, which is the default of the contract variable that binds one. A fact
 * whose file this project does not have is left out, and so is not compared.
 */
export function statedFacts({ rulesFile = RULES_FILE, contractFile = CONTRACT_FILE } = {}) {
  const facts = existsSync(rulesFile) ? { ...loadRules(rulesFile) } : {};
  if (existsSync(contractFile)) {
    const { config = {} } = JSON.parse(readFileSync(contractFile, "utf8"));
    const binding = Object.entries(config).find(([name, spec]) => !name.startsWith("$") && spec.binds);
    if (binding) facts.apiDefaultPort = binding[1].default.effective;
  }
  return facts;
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sorted = (list) => [...list].sort();

/** How a stated fact and a module's copy are compared, where plain equality is not the rule. */
const COMPARE = {
  // The moves from each status are a set: the order they are listed in is not a rule.
  transitions: (expected, actual) => {
    const problems = [];
    const moves = actual ?? {};
    for (const [from, to] of Object.entries(expected)) {
      if (!Array.isArray(moves[from])) problems.push(`states no moves from \`${from}\``);
      else if (!same(sorted(moves[from]), sorted(to))) problems.push(`moves from \`${from}\` are ${JSON.stringify(moves[from])}, expected ${JSON.stringify(to)}`);
    }
    for (const from of Object.keys(moves)) if (!(from in expected)) problems.push(`states moves from \`${from}\`, which is not a status`);
    return problems;
  },
};

/**
 * Every way `actual` differs from `expected`, or an empty list. The module must print exactly the facts
 * its manifest `declared`, so a fact cannot quietly stop being compared by being left out; a declared
 * fact this project states nowhere is not compared. Statuses are compared in order, since the order is
 * the lifecycle a person reads.
 */
export function compareFacts(expected, actual, declared) {
  if (actual === null || typeof actual !== "object" || Array.isArray(actual)) return ["did not print a JSON object"];
  const problems = [];
  for (const key of declared) if (!(key in actual)) problems.push(`does not state \`${key}\`, which its module.json says it repeats`);
  for (const key of Object.keys(actual)) {
    if (!FACTS.includes(key)) problems.push(`states \`${key}\`, which is not a fact this project states`);
    else if (!declared.includes(key)) problems.push(`states \`${key}\`, which its module.json does not list under facts.keys`);
    else if (!(key in expected)) continue;
    else if (COMPARE[key]) problems.push(...COMPARE[key](expected[key], actual[key]));
    else if (!same(actual[key], expected[key])) problems.push(`${key} is ${JSON.stringify(actual[key])}, expected ${JSON.stringify(expected[key])}`);
  }
  return problems;
}

/** Asks a module for its facts with the command its manifest names. Returns the parsed table, or throws with why not. */
function ask(module) {
  const [command, ...args] = module.facts.run;
  const shown = module.facts.run.join(" ");
  const { status, stdout } = run(command, args, { cwd: join(ROOT, module.dir), capture: true });
  if (status !== 0) throw new Error(`\`${shown}\` exited ${status}`);
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error(`\`${shown}\` printed something other than JSON: ${stdout.trim().slice(0, 80)}`);
  }
}

function main() {
  const requested = process.argv.slice(2);
  const present = presentModules().filter((m) => m.facts);
  const unknown = requested.filter((id) => !present.some((m) => m.id === id));
  if (unknown.length > 0) {
    console.error(`check-facts: ${unknown.join(", ")} is not a module present here that repeats a fact. Present: ${present.map((m) => m.id).join(", ") || "none"}.`);
    return 2;
  }
  const targets = requested.length > 0 ? present.filter((m) => requested.includes(m.id)) : present;
  const expected = statedFacts();
  let code = 0;
  for (const module of targets) {
    let actual;
    try {
      actual = ask(module);
    } catch (err) {
      console.error(`check-facts: cannot ask ${module.id} for its facts: ${err.message}`);
      code = 2;
      continue;
    }
    const problems = compareFacts(expected, actual, module.facts.keys);
    const unstated = module.facts.keys.filter((key) => !(key in expected));
    if (problems.length > 0) {
      console.error(`check-facts: ${module.id} states facts differently from the files that declare them\n`);
      for (const problem of problems) console.error(`  ${module.id} ${problem}`);
      code = Math.max(code, 1);
    } else {
      const compared = module.facts.keys.filter((key) => key in expected);
      const note = unstated.length > 0 ? ` (${unstated.join(", ")} not compared: no file in this project states it)` : "";
      console.log(`check-facts: ${module.id} states ${compared.join(", ")} as this project does${note}.`);
    }
  }
  return code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
