/**
 * Reports which hand-pinned tools have a newer release. Dependabot moves actions, images and module
 * dependencies; these it cannot see, because each is a version (and usually a checksum) written into a
 * workflow. A pin nothing reports goes stale without anyone deciding it should.
 *
 * Report-only, like the scans in security.yml: a newer release is information, not a failure, since a
 * pin moves only after someone reads the release and takes its checksum from it
 * (docs/toolchain-updates.md). The run fails only when a lookup could not be made.
 *
 *   node scripts/check-pins.mjs          # needs network; GH_TOKEN raises GitHub's rate limit
 *
 * Prints a Markdown table. Exit 0 every pin was looked up · 2 a lookup failed.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT } from "./modules.mjs";

/**
 * Every hand pin: where it is written, how to read it, and where its releases are published. A pin in a
 * file this project does not have is skipped, so a project without the Go service reports no Go tools.
 */
export const PINS = [
  { name: "gitleaks", file: ".github/workflows/security.yml", pattern: /GITLEAKS_VERSION:\s*"(\d+\.\d+\.\d+)"/, github: "gitleaks/gitleaks" },
  { name: "Trivy", file: ".github/workflows/security.yml", pattern: /TRIVY_VERSION:\s*"(\d+\.\d+\.\d+)"/, github: "aquasecurity/trivy" },
  { name: "actionlint", file: ".github/actions/setup-actionlint/action.yml", pattern: /ACTIONLINT_VERSION:\s*"(\d+\.\d+\.\d+)"/, github: "rhysd/actionlint" },
  { name: "zizmor", file: ".github/actions/setup-zizmor/action.yml", pattern: /ZIZMOR_VERSION:\s*"(\d+\.\d+\.\d+)"/, github: "zizmorcore/zizmor" },
  { name: "golangci-lint", file: ".github/workflows/verify.yml", pattern: /^\s+version: v(\d+\.\d+\.\d+)$/m, github: "golangci/golangci-lint" },
  // golang/vuln publishes tags, not GitHub releases.
  { name: "govulncheck", file: ".github/workflows/security.yml", pattern: /govulncheck@v(\d+\.\d+\.\d+)/, githubTags: "golang/vuln" },
  { name: "pip-audit", file: ".github/workflows/security.yml", pattern: /pip-audit==(\d+\.\d+\.\d+)/, pypi: "pip-audit" },
  {
    name: "mcp-publisher",
    file: ".github/workflows/mcp-publish.yml",
    pattern: /registry\/releases\/download\/v(\d+\.\d+\.\d+)\/mcp-publisher/,
    github: "modelcontextprotocol/registry",
  },
];

/** Lines that look like a hand pin: a version env var, a tool run at a version, a pinned release download. */
const PIN_SHAPED = [/^\s*[A-Z][A-Z0-9_]*_VERSION:\s*"?v?\d/, /@v\d+\.\d+\.\d+/, /==\d+\.\d+\.\d+/, /\/releases\/download\/v?\d/, /^\s+version: v\d/];

/** Workflow and action lines shaped like a pin that no entry in PINS reads, so no report would cover. */
export function unknownPins(files, pins = PINS) {
  const found = [];
  for (const [path, text] of Object.entries(files)) {
    text.split(/\r?\n/).forEach((line, i) => {
      if (/^\s*#/.test(line) || /^\s*-?\s*uses:/.test(line) || !PIN_SHAPED.some((shape) => shape.test(line))) return;
      const known = pins.some((pin) => pin.file === path && new RegExp(pin.pattern.source).test(line));
      if (!known) found.push(`${path}:${i + 1}: ${line.trim()}`);
    });
  }
  return found;
}

export function compareVersions(a, b) {
  const [x, y] = [a, b].map((v) => v.replace(/^v/, "").split(".").map(Number));
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
}

const STABLE = /^v?\d+\.\d+\.\d+$/;

/** The newest stable version of a pin's tool, from the source its entry names. */
export async function latest(pin, fetch, token) {
  const github = (path) =>
    fetch(`https://api.github.com/repos/${path}`, {
      headers: { accept: "application/vnd.github+json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    });
  const json = async (response, what) => {
    if (!response.ok) throw new Error(`${what} answered ${response.status}`);
    return response.json();
  };
  if (pin.github) return (await json(await github(`${pin.github}/releases/latest`), pin.github)).tag_name.replace(/^v/, "");
  if (pin.githubTags) {
    const tags = (await json(await github(`${pin.githubTags}/tags?per_page=100`), pin.githubTags)).map((t) => t.name).filter((n) => STABLE.test(n));
    if (tags.length === 0) throw new Error(`${pin.githubTags} has no stable tag`);
    return tags.sort(compareVersions).at(-1).replace(/^v/, "");
  }
  return (await json(await fetch(`https://pypi.org/pypi/${pin.pypi}/json`), `PyPI ${pin.pypi}`)).info.version;
}

/** One row per pin present: its version, the latest, and whether it is behind. Lookups that fail are rows too. */
export async function report({ root = ROOT, fetch = globalThis.fetch, token } = {}) {
  const rows = [];
  for (const pin of PINS) {
    const path = join(root, pin.file);
    if (!existsSync(path)) continue;
    const pinned = pin.pattern.exec(readFileSync(path, "utf8"))?.[1];
    if (pinned === undefined) {
      rows.push({ pin, pinned: "?", error: `no version found in ${pin.file}; update PINS in scripts/check-pins.mjs` });
      continue;
    }
    try {
      const newest = await latest(pin, fetch, token);
      rows.push({ pin, pinned, newest, behind: compareVersions(newest, pinned) > 0 });
    } catch (err) {
      rows.push({ pin, pinned, error: err.message });
    }
  }
  return rows;
}

export function table(rows) {
  const lines = ["| Tool | Pinned | Latest | |", "|---|---|---|---|"];
  for (const row of rows) {
    const state = row.error ? `could not check: ${row.error}` : row.behind ? "**newer release**" : "current";
    lines.push(`| ${row.pin.name} | ${row.pinned} | ${row.newest ?? "?"} | ${state} |`);
  }
  if (rows.length === 0) lines.push("| (no hand pins in this project) | | | |");
  return lines.join("\n");
}

async function main() {
  const rows = await report({ token: process.env.GH_TOKEN });
  console.log(`### Hand-pinned tools\n\n${table(rows)}\n\nMove a pin by hand, with the checksum from its release: docs/toolchain-updates.md.`);
  return rows.some((row) => row.error) ? 2 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
