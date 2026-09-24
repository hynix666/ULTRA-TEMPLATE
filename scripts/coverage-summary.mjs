/**
 * One line of test coverage for a CI job summary, from an lcov file or a Go coverage profile.
 *
 * Coverage is reported, never gated: a threshold turns into tests written for the number. But a report
 * must not invent one, so a file that is missing or holds nothing this can read fails the step, the same
 * rule the scans in security.yml follow: a report that could not be made must not read as a result.
 *
 *   node scripts/coverage-summary.mjs <module> <lcov.info | coverage.out>
 *
 * Prints a Markdown table row: | module | share of lines | covered of total |.
 * Exit 0 printed · 2 the file is missing or unreadable.
 */
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** Covered and total lines from an lcov file, summed over every file it names. */
export function lcovCoverage(text) {
  let covered = 0;
  let total = 0;
  let seen = false;
  for (const line of text.split(/\r?\n/)) {
    const count = /^(LH|LF):(\d+)$/.exec(line);
    if (!count) continue;
    seen = true;
    if (count[1] === "LH") covered += Number(count[2]);
    else total += Number(count[2]);
  }
  if (!seen) throw new Error("the lcov file holds no line counts");
  return { covered, total };
}

/**
 * Covered and total statements from a Go coverage profile. A block can be listed more than once when
 * several test binaries report it; it counts once, as covered if any of them covered it.
 */
export function goCoverage(text) {
  const blocks = new Map();
  text.split(/\r?\n/).forEach((line, i) => {
    if (i === 0 || line.trim() === "") return;
    const block = /^(.+:\d+\.\d+,\d+\.\d+) (\d+) (\d+)$/.exec(line);
    if (!block) throw new Error(`cannot read line ${i + 1} of the Go coverage profile: ${line.slice(0, 80)}`);
    const [, key, statements, count] = block;
    const seen = blocks.get(key);
    blocks.set(key, { statements: Number(statements), covered: (seen?.covered ?? false) || Number(count) > 0 });
  });
  if (blocks.size === 0) throw new Error("the Go coverage profile holds no statements");
  let covered = 0;
  let total = 0;
  for (const block of blocks.values()) {
    total += block.statements;
    if (block.covered) covered += block.statements;
  }
  return { covered, total };
}

export const summarize = (module, { covered, total }) =>
  `| ${module} | ${total === 0 ? "n/a" : `${((covered / total) * 100).toFixed(1)}%`} | ${covered} of ${total} |`;

function main() {
  const [module, file] = process.argv.slice(2);
  if (!module || !file) {
    console.error("usage: node scripts/coverage-summary.mjs <module> <lcov.info | coverage.out>");
    return 2;
  }
  if (!existsSync(file)) {
    console.error(`coverage-summary: ${file} does not exist, so the coverage run did not write it`);
    return 2;
  }
  const text = readFileSync(file, "utf8");
  try {
    console.log(summarize(module, text.startsWith("mode:") ? goCoverage(text) : lcovCoverage(text)));
    return 0;
  } catch (err) {
    console.error(`coverage-summary: ${file}: ${err.message}`);
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
