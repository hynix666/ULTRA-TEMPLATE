// Prints this module's task rules as JSON, for scripts/check-rules.mjs to compare with the one statement
// of them in scripts/rules/task-rules.json. Run with `npm run --silent rules`.
import { MAX_TITLE_LENGTH, nextStatuses, STATUSES } from "../src/features/tasks/model.ts";

const transitions = Object.fromEntries(STATUSES.map((status) => [status, nextStatuses(status)]));
console.log(JSON.stringify({ statuses: STATUSES, transitions, maxTitleLength: MAX_TITLE_LENGTH }));
