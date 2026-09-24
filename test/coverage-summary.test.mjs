// The coverage summary is report-only, but it must not report a number it did not read: a file it
// cannot parse is a failure, not 0% and not 100%.
import assert from "node:assert/strict";
import { test } from "node:test";
import { coverageOf, goCoverage, lcovCoverage, summarize, TABLE_HEADER } from "../scripts/coverage-summary.mjs";

test("lcov totals are summed across files", () => {
  const lcov = ["SF:src/a.ts", "LH:9", "LF:10", "end_of_record", "SF:src/b.ts", "LH:1", "LF:10", "end_of_record", ""].join("\n");
  assert.deepEqual(lcovCoverage(lcov), { covered: 10, total: 20 });
});

test("a Go profile counts statements, each block once however many packages report it", () => {
  const profile = [
    "mode: atomic",
    "example.com/m/a.go:3.1,5.2 2 1",
    "example.com/m/a.go:6.1,8.2 3 0",
    // The same block again, covered this time: it counts once, as covered.
    "example.com/m/a.go:6.1,8.2 3 4",
    "example.com/m/b.go:1.1,2.2 5 0",
    "",
  ].join("\n");
  assert.deepEqual(goCoverage(profile), { covered: 5, total: 10 });
});

test("the summary line names the module and the share of lines", () => {
  assert.equal(summarize("api-ts", { covered: 10, total: 20 }), "| api-ts | 50.0% | 10 of 20 |");
});

test("nothing it can read is an error, never a number", () => {
  assert.throws(() => lcovCoverage("TN:\n"), /no line counts/);
  assert.throws(() => goCoverage("mode: set\n"), /no statements/);
  assert.throws(() => goCoverage("mode: set\nnot a block\n"), /cannot read line 2/);
});

test("the table the runner prints has one header, with a column for each part of a row", () => {
  const row = summarize("m", coverageOf("LF:4\nLH:3\n"));
  const columns = (line) => line.split("|").length;
  assert.equal(TABLE_HEADER.length, 2);
  for (const line of TABLE_HEADER) assert.equal(columns(line), columns(row));
  assert.deepEqual(coverageOf("mode: set\na.go:1.1,2.2 3 1\n"), { covered: 3, total: 3 });
});
