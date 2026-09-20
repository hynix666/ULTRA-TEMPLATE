/** The statuses a task moves through, in the order a task usually visits them. */
export const STATUSES: readonly ["todo", "in_progress", "done"] = ["todo", "in_progress", "done"];

export type Status = (typeof STATUSES)[number];

/** Every legal move, matching the task services. Anything absent is refused, including staying put. */
const NEXT: Readonly<Record<Status, readonly Status[]>> = {
  todo: ["in_progress"],
  in_progress: ["todo", "done"],
  done: [],
};

export function isStatus(value: unknown): value is Status {
  return STATUSES.some((status) => status === value);
}

/** The statuses a task in `status` may move to next. */
export function nextStatuses(status: Status): readonly Status[] {
  return NEXT[status];
}

export function canTransition(from: Status, to: Status): boolean {
  return NEXT[from].includes(to);
}

/** Validates external input, such as a status read from an API response. */
export function parseStatus(value: unknown): Status {
  if (isStatus(value)) return value;
  throw new TypeError(`status must be one of ${STATUSES.join(", ")}, got ${JSON.stringify(value)}`);
}
