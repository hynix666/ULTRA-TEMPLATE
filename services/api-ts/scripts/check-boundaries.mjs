/**
 * The import-boundary rule for this service, checked over every source file instead of left to review.
 *
 * Each layer lists what it MAY import. An allowlist, because a denylist only forbids the mistakes its
 * author already thought of:
 *
 *   src/domain       its own files only; no packages and no node: built-ins (no I/O, clock or randomness)
 *   src/application  the domain and its own files
 *   src/adapters     the domain, the application, its own files, node: built-ins and packages
 *   src/main.ts and src/config.ts are the composition root and may import anything
 *   any other file under src/ belongs to no layer, and fails
 *
 * Specifiers are read with a regular expression, not a parser: static import/export-from, side-effect
 * imports and dynamic import() with a string literal.
 * An import-shaped string inside a comment can raise a false alarm; nothing makes it miss a real import.
 *
 *   node scripts/check-boundaries.mjs
 *
 * Exit 0 clean · 1 violations.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, posix, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const LAYERS = [
  { dir: "src/domain", mayImport: ["src/domain"], builtins: false, packages: false },
  { dir: "src/application", mayImport: ["src/domain", "src/application"], builtins: false, packages: false },
  { dir: "src/adapters", mayImport: ["src/domain", "src/application", "src/adapters"], builtins: true, packages: true },
];

const IMPORT_RE =
  /(?:^|[\n;])\s*(?:import|export)\b[^'"`;]*?\bfrom\s*["']([^"']+)["']|(?:^|[\n;])\s*import\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

/** The composition root may import anything. Every other file under src/ must belong to a layer. */
export const COMPOSITION_ROOT = ["src/main.ts", "src/config.ts"];

export const specifiers = (source) => [...source.matchAll(IMPORT_RE)].map((m) => m[1] ?? m[2] ?? m[3]);

/** Violations in one file. `file` is a POSIX path relative to the service root, such as src/domain/task.ts. */
export function checkFile(file, source) {
  const layer = LAYERS.find((l) => file.startsWith(`${l.dir}/`));
  if (layer === undefined) {
    // A file in no layer is a file no rule covers; a new directory must not escape by being new.
    return COMPOSITION_ROOT.includes(file)
      ? []
      : [`${file} belongs to no layer. Move it into ${LAYERS.map((l) => l.dir).join(", ")}, or add a layer with its own allowlist.`];
  }
  const problems = [];
  for (const spec of specifiers(source)) {
    if (spec.startsWith(".")) {
      const target = posix.normalize(posix.join(posix.dirname(file), spec));
      if (!layer.mayImport.some((dir) => target.startsWith(`${dir}/`))) {
        problems.push(`${file} imports "${spec}" (${target}); ${layer.dir} may import only from ${layer.mayImport.join(", ")}.`);
      }
    } else if (spec.startsWith("node:")) {
      if (!layer.builtins) problems.push(`${file} imports "${spec}"; ${layer.dir} performs no I/O and may not use Node built-ins.`);
    } else if (!layer.packages) {
      problems.push(`${file} imports package "${spec}"; ${layer.dir} may not depend on packages. Put the integration in an adapter.`);
    }
  }
  return problems;
}

function sourceFiles(root, dir) {
  const out = [];
  for (const entry of readdirSync(join(root, dir))) {
    const path = posix.join(dir, entry);
    if (statSync(join(root, path)).isDirectory()) out.push(...sourceFiles(root, path));
    else if (/\.(ts|tsx|mts|js|mjs)$/.test(entry)) out.push(path);
  }
  return out;
}

export function checkTree(root) {
  const files = sourceFiles(root, "src");
  return { files: files.length, problems: files.flatMap((file) => checkFile(file, readFileSync(join(root, file), "utf8"))) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const { files, problems } = checkTree(root);
  if (problems.length > 0) {
    console.error(`check-boundaries: ${problems.length} violation(s)\n\n  ${problems.join("\n  ")}`);
    process.exitCode = 1;
  } else {
    console.log(`check-boundaries: OK. ${files} files in ${relative(process.cwd(), root) || "."}, 0 violations.`);
  }
}
