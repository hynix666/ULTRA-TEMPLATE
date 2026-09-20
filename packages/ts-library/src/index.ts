// The package's public API. Everything a consumer may import is exported here and nowhere else, so
// the `exports` map in package.json can stay a single entry.
export { canTransition, isStatus, nextStatuses, parseStatus, STATUSES, type Status } from "./status.ts";
