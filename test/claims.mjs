/**
 * Holds a document's list of promises to what keeps each one: a numbered check-hygiene rule, or a file
 * a reader can open. A promise is worth what a check proves, and a list of them drifts like any other
 * documentation: a claim is added with nothing behind it, or its check is deleted and the claim stays.
 * Shared by test/agents-claims.test.mjs and the template's own README ledger.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../scripts/modules.mjs";

/** The bold lead of every `- **…**` bullet in `text`, in reading order. */
export const claims = (text) => [...text.matchAll(/^- \*\*(.+?)\*\*/gm)].map((m) => m[1]);

/** The rule numbers scripts/check-hygiene.mjs documents in its header. */
export function hygieneRules(root = ROOT) {
  const header = readFileSync(join(root, "scripts/check-hygiene.mjs"), "utf8").split("*/")[0];
  return [...header.matchAll(/^ \*\s+(\d+)\. /gm)].map((m) => Number(m[1]));
}

/**
 * Every way `ledger` and `stated` disagree: a claim with no entry, an entry for a claim no longer made,
 * a rule the header does not document, a path that does not exist. Empty when they agree.
 */
export function auditLedger(stated, ledger, { root = ROOT, rules = hygieneRules(root) } = {}) {
  const problems = [];
  for (const claim of stated) if (!(claim in ledger)) problems.push(`"${claim}" names nothing that enforces it`);
  for (const [claim, { rules: cited = [], paths = [] }] of Object.entries(ledger)) {
    if (!stated.includes(claim)) problems.push(`the ledger holds "${claim}", which is no longer claimed`);
    if (cited.length === 0 && paths.length === 0) problems.push(`"${claim}" cites neither a rule nor a path`);
    for (const rule of cited) if (!rules.includes(rule)) problems.push(`"${claim}" cites check-hygiene rule ${rule}, which its header does not document`);
    for (const path of paths) if (!existsSync(join(root, path))) problems.push(`"${claim}" cites ${path}, which does not exist`);
  }
  return problems;
}
