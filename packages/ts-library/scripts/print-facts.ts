// Prints the facts this package repeats as JSON, for scripts/check-facts.mjs to compare with the one
// statement of them in scripts/rules/task-rules.json. Run with `npm run --silent facts`. The package
// validates no titles, so it prints no title length.
import { nextStatuses, STATUSES } from "../src/index.ts";

const transitions = Object.fromEntries(STATUSES.map((status) => [status, nextStatuses(status)]));
console.log(JSON.stringify({ statuses: STATUSES, transitions }));
