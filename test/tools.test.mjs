// The tool manifest and its installer must be seen to refuse: a download whose SHA-256 is not the
// pinned one, a manifest entry that says nothing about where its checksum comes from.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { bump, command, install, loadTools, localTools, platform, validateTools } from "../scripts/tools.mjs";

/** A tar.gz holding one executable, its bytes, and a fetch that serves it at `url`. */
function release(t, url, member = "demo") {
  const work = mkdtempSync(join(tmpdir(), "tools-test-"));
  t.after(() => rmSync(work, { recursive: true, force: true }));
  mkdirSync(join(work, "src"));
  writeFileSync(join(work, "src", member), "#!/bin/sh\necho demo 1.2.3\n");
  const archive = join(work, "demo.tar.gz");
  assert.equal(spawnSync("tar", ["-czf", archive, "-C", join(work, "src"), member]).status, 0);
  const bytes = readFileSync(archive);
  const fetch = async (address) => (address === url ? new Response(bytes) : new Response("", { status: 404 }));
  return { work, bytes, sha: createHash("sha256").update(bytes).digest("hex"), fetch };
}

const tool = (url, sha, extra = {}) => ({
  demo: {
    version: "1.2.3",
    for: "chassis",
    releases: { github: "octo/demo" },
    platforms: { [platform()]: { url, sha256: sha, files: ["demo"] } },
    checksums: { file: "https://example.test/v{version}/checksums.txt" },
    ...extra,
  },
});

test("the repository's own manifest is well formed", () => {
  assert.deepEqual(validateTools(loadTools()), []);
});

test("a tool installs when its SHA-256 is the pinned one", async (t) => {
  const url = "https://example.test/v1.2.3/demo.tar.gz";
  const { work, sha, fetch } = release(t, url);
  const written = await install("demo", { tools: tool("https://example.test/v{version}/demo.tar.gz", sha), dir: join(work, "bin"), fetch });
  assert.deepEqual(written, [join(work, "bin", "demo")]);
});

test("a download whose SHA-256 differs is refused, and nothing is unpacked", async (t) => {
  const url = "https://example.test/v1.2.3/demo.tar.gz";
  const { work, fetch } = release(t, url);
  const pinned = "0".repeat(64);
  await assert.rejects(
    () => install("demo", { tools: tool("https://example.test/v{version}/demo.tar.gz", pinned), dir: join(work, "bin"), fetch }),
    /has SHA-256 [0-9a-f]{64}, not the pinned 0{64}\. The asset was replaced, or the pin is wrong: nothing was unpacked/,
  );
  assert.equal(existsSync(join(work, "bin")), false);
});

test("an entry that says nothing about where its checksum comes from, or is both kinds of tool, is refused", () => {
  const bad = tool("https://example.test/x.tar.gz", "a".repeat(64), { checksums: {}, run: ["demo"] });
  const found = validateTools(bad).join("\n");
  assert.match(found, /either downloaded \(`platforms`\) or run by version/);
  assert.match(found, /`checksums` must say where the release publishes its checksum/);
  assert.match(validateTools({ x: { version: "1.2", for: "moon", releases: {}, run: ["x"] } }).join("\n"), /version` must be X\.Y\.Z.*\n.*`for` must be one of.*\n.*`releases` must name/);
});

test("a tool run by version is run with the pinned version filled in", () => {
  const tools = { audit: { version: "4.5.6", for: "ci", releases: { pypi: "audit" }, run: ["uvx", "audit=={version}"] } };
  assert.deepEqual(command("audit", ["--strict"], tools), ["uvx", "audit==4.5.6", "--strict"]);
});

test("a checkout needs the chassis's tools, and those of the toolchains its modules use", () => {
  const tools = loadTools();
  const minimal = localTools([], tools);
  const withGo = localTools(["go"], tools);
  assert.ok(minimal.every((name) => tools[name].for === "chassis"));
  assert.ok(withGo.some((name) => tools[name].for === "go"));
  assert.ok(!withGo.some((name) => tools[name].for === "ci"), "CI-only tools are never installed locally");
});

test("bump takes the new checksum from the release, never from anyone's copy", async () => {
  const sha = "b".repeat(64);
  const tools = tool("https://example.test/v{version}/demo.tar.gz", "a".repeat(64));
  const fetch = async (address) =>
    address === "https://example.test/v2.0.0/checksums.txt" ? new Response(`${"c".repeat(64)}  other.tar.gz\n${sha}  demo.tar.gz\n`) : new Response("", { status: 404 });
  const next = await bump("demo", "2.0.0", { tools, fetch });
  assert.equal(next.demo.version, "2.0.0");
  assert.equal(next.demo.platforms[platform()].sha256, sha);
  await assert.rejects(() => bump("demo", "2.0.1", { tools, fetch }), /answered 404/);
});
