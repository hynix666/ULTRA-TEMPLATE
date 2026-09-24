// The agent environment's decisions, without the network: which release a checksum list names, which Go
// release fits go.mod, what a session start needs, and what reaches the session's environment.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { alreadyPrepared, envLines, goRelease, nodeIndexUrl, nodePlatform, nodeRelease, OLDEST_NODE } from "../scripts/agent-env.mjs";

const sha = (c) => c.repeat(64);

test("the Node release comes from the checksum list of the version .node-version names", () => {
  assert.equal(nodeIndexUrl("24"), "https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt");
  assert.equal(nodeIndexUrl("24.13.0"), "https://nodejs.org/dist/v24.13.0/SHASUMS256.txt");
  const list = [`${sha("a")}  node-v24.21.0-darwin-arm64.tar.gz`, `${sha("b")}  node-v24.21.0-linux-x64.tar.gz`, `${sha("c")}  node-v24.21.0-linux-x64.tar.xz`].join("\n");
  assert.deepEqual(nodeRelease(list, "linux-x64"), { sha256: sha("b"), file: "node-v24.21.0-linux-x64.tar.gz", version: "24.21.0" });
  assert.throws(() => nodeRelease(list, "linux-arm64"), /lists no node tarball for linux-arm64/);
  assert.equal(nodePlatform("linux", "arm64"), "linux-arm64");
  assert.throws(() => nodePlatform("win32", "x64"), /no Node release is picked for win32-x64/);
});

test("the Go release is the newest stable one of the series go.mod names", () => {
  const file = (os, arch) => ({ os, arch, kind: "archive", filename: `x-${os}-${arch}.tar.gz`, sha256: sha("d") });
  const releases = [
    { version: "go1.27rc1", stable: false, files: [file("linux", "amd64")] },
    { version: "go1.26.2", stable: true, files: [file("linux", "amd64"), file("darwin", "arm64")] },
    { version: "go1.26.1", stable: true, files: [file("linux", "amd64")] },
    { version: "go1.25.9", stable: true, files: [file("linux", "amd64")] },
  ];
  assert.equal(goRelease(releases, "1.26", "linux", "x64").version, "go1.26.2");
  assert.equal(goRelease(releases, "1.26.0", "darwin", "arm64").file, "x-darwin-arm64.tar.gz");
  assert.throws(() => goRelease(releases, "1.24", "linux", "x64"), /no stable go1\.24 release/);
});

test("clearing or compacting keeps the session; a start or a resume prepares it", () => {
  assert.match(alreadyPrepared('{"source":"compact"}') ?? "", /keeps the session/);
  assert.match(alreadyPrepared('{"source":"clear"}') ?? "", /keeps the session/);
  assert.equal(alreadyPrepared('{"source":"startup"}'), null);
  assert.equal(alreadyPrepared('{"source":"resume"}'), null);
  assert.equal(alreadyPrepared(""), null);
  assert.equal(alreadyPrepared("not json"), null);
});

test("the session's PATH puts what was set up first, and Go chooses its toolchain from go.mod", () => {
  const [path, go] = envLines({ paths: ["/r/.tools/node/bin", "/r/.tools/bin"], go: true });
  assert.match(path, /^export PATH="\/r\/\.tools\/node\/bin.\/r\/\.tools\/bin.\$PATH"$/);
  assert.equal(go, "export GOTOOLCHAIN=auto");
  assert.equal(envLines({ paths: [], go: false }).length, 1);
});

test("the script is written for the oldest Node it claims, which is older than the one it installs", () => {
  const pinned = Number(readFileSync(new URL("../.node-version", import.meta.url), "utf8").trim().split(".")[0]);
  assert.ok(OLDEST_NODE < pinned, `OLDEST_NODE ${OLDEST_NODE} is not older than .node-version ${pinned}`);
});
