/**
 * Reports which hand-pinned tools have a newer release. Dependabot moves actions, images and module
 * dependencies; these it cannot see, so every one is declared in scripts/tools/tools.json, and this lists
 * each against the latest release where its manifest entry says it is published.
 *
 * Report-only, like the scans in security.yml: a newer release is information, not a failure, since a
 * pin moves only after someone reads the release (`node scripts/tools.mjs bump NAME` then takes its
 * checksum from it; docs/toolchain-updates.md). The run fails only when a lookup could not be made.
 *
 *   node scripts/check-pins.mjs          # needs network; GH_TOKEN raises GitHub's rate limit
 *
 * Prints a Markdown table. Exit 0 every pin was looked up · 2 a lookup failed.
 */
import { pathToFileURL } from "node:url";
import { compareVersions, latest, loadTools } from "./tools.mjs";

/** One row per pinned tool: its version, the latest, and whether it is behind. Lookups that fail are rows too. */
export async function report({ tools = loadTools(), fetch = globalThis.fetch, token } = {}) {
  const rows = [];
  for (const [name, tool] of Object.entries(tools)) {
    try {
      const newest = await latest(name, { tools, fetch, token });
      rows.push({ name, pinned: tool.version, newest, behind: compareVersions(newest, tool.version) > 0 });
    } catch (err) {
      rows.push({ name, pinned: tool.version, error: err.message });
    }
  }
  return rows;
}

export function table(rows) {
  const lines = ["| Tool | Pinned | Latest | |", "|---|---|---|---|"];
  for (const row of rows) {
    const state = row.error ? `could not check: ${row.error}` : row.behind ? "**newer release**" : "current";
    lines.push(`| ${row.name} | ${row.pinned} | ${row.newest ?? "?"} | ${state} |`);
  }
  return lines.join("\n");
}

async function main() {
  const rows = await report({ token: process.env.GH_TOKEN });
  console.log(`### Hand-pinned tools\n\n${table(rows)}\n\nMove a pin with \`node scripts/tools.mjs bump NAME\`, which takes the checksum from the release: docs/toolchain-updates.md.`);
  return rows.some((row) => row.error) ? 2 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
