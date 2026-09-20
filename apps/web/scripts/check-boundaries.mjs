/**
 * The import-boundary rule for the web app, checked over every source file instead of left to review.
 *
 * Code flows one way, shared → features → app, and features never reach into each other — the structure
 * bulletproof-react enforces with ESLint, written here as a dependency-free allowlist:
 *
 *   src/lib              its own files and packages
 *   src/features/<name>  its own folder, src/lib and packages; never another feature, never src/app
 *   src/app              its own files, src/lib, packages, and a feature only through its index.ts
 *   src/main.tsx         the entry point, and may import anything
 *   any other code file under src/ belongs to no layer, and fails
 *
 * Specifiers are read with a regular expression, not a parser, as in services/api-ts: an import-shaped
 * string in a comment can raise a false alarm, but nothing makes it miss a real import.
 *
 *   node scripts/check-boundaries.mjs
 *
 * Exit 0 clean · 1 violations.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ENTRY = "src/main.tsx";

const IMPORT_RE =
  /(?:^|[\n;])\s*(?:import|export)\b[^'"`;]*?\bfrom\s*["']([^"']+)["']|(?:^|[\n;])\s*import\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

export const specifiers = (source) => [...source.matchAll(IMPORT_RE)].map((m) => m[1] ?? m[2] ?? m[3]);

/** The layer a file belongs to and what it may import, or undefined for a file in no layer. */
export function layerOf(file) {
  const feature = /^src\/features\/([^/]+)\//.exec(file)?.[1];
  if (feature !== undefined) {
    const own = `src/features/${feature}/`;
    return { name: `src/features/${feature}`, may: (t) => t.startsWith(own) || t.startsWith("src/lib/"), allowed: `${own}, src/lib/` };
  }
  if (file.startsWith("src/app/")) {
    return {
      name: "src/app",
      // `../features/tasks`, `../features/tasks/index` and `../features/tasks/index.ts` all resolve to the
      // feature's index.ts under bundler resolution; anything deeper in the folder is private.
      may: (t) => t.startsWith("src/app/") || t.startsWith("src/lib/") || /^src\/features\/[^/]+(\/index(\.tsx?)?)?$/.test(t),
      allowed: "src/app/, src/lib/, and src/features/<name>/index.ts",
    };
  }
  if (file.startsWith("src/lib/")) return { name: "src/lib", may: (t) => t.startsWith("src/lib/"), allowed: "src/lib/" };
  return undefined;
}

/** Violations in one file. `file` is a POSIX path relative to the app root, such as src/app/app.tsx. */
export function checkFile(file, source) {
  if (file === ENTRY) return [];
  const layer = layerOf(file);
  if (layer === undefined) {
    return [`${file} belongs to no layer. Move it into src/app, src/features/<name> or src/lib.`];
  }
  const problems = [];
  for (const spec of specifiers(source)) {
    if (!spec.startsWith(".")) continue; // packages are allowed in every layer
    const target = posix.normalize(posix.join(posix.dirname(file), spec));
    if (!layer.may(target)) problems.push(`${file} imports "${spec}" (${target}); ${layer.name} may import only from ${layer.allowed}.`);
  }
  return problems;
}

function sourceFiles(root, dir) {
  const out = [];
  for (const entry of readdirSync(join(root, dir))) {
    const path = posix.join(dir, entry);
    if (statSync(join(root, path)).isDirectory()) out.push(...sourceFiles(root, path));
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry)) out.push(path);
  }
  return out;
}

export function checkTree(root) {
  const files = sourceFiles(root, "src");
  return { files: files.length, problems: files.flatMap((file) => checkFile(file, readFileSync(join(root, file), "utf8"))) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { files, problems } = checkTree(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
  if (problems.length > 0) {
    console.error(`check-boundaries: ${problems.length} violation(s)\n\n  ${problems.join("\n  ")}`);
    process.exitCode = 1;
  } else {
    console.log(`check-boundaries: OK. ${files} files, 0 violations.`);
  }
}
