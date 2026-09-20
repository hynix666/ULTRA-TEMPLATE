import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { ACTIONS_APP_ID, isRepo, plan, REQUIRED_CHECK, RULESET } from "../scripts/configure-github.mjs";

test("the required check is a job that verify.yml actually defines", () => {
  // A ruleset naming a check no workflow reports would block every pull request forever.
  const workflow = readFileSync(new URL("../.github/workflows/verify.yml", import.meta.url), "utf8");
  assert.match(workflow, new RegExp(`^ {2}${REQUIRED_CHECK}:\\s*$`, "m"));
});

test("the ruleset requires pull requests and the verify check from GitHub Actions, with no bypass", () => {
  const rule = (type) => RULESET.rules.find((r) => r.type === type);
  assert.deepEqual(rule("required_status_checks").parameters.required_status_checks, [{ context: "verify", integration_id: ACTIONS_APP_ID }]);
  assert.equal(rule("required_status_checks").parameters.strict_required_status_checks_policy, true);
  assert.deepEqual(rule("pull_request").parameters.allowed_merge_methods, ["squash"]);
  // GitHub added this parameter defaulted on; unset, it would block a sole maintainer's own merges.
  assert.equal(rule("pull_request").parameters.require_extra_approval_for_unattributed_changes, false);
  assert.ok(rule("non_fast_forward") && rule("deletion"));
  assert.deepEqual(RULESET.bypass_actors, []);
  assert.deepEqual(RULESET.conditions.ref_name.include, ["~DEFAULT_BRANCH"]);
});

test("release settings are applied only when the release workflow exists", () => {
  const names = (release) => plan("octo/app", { release }).map((s) => s.name).join("\n");
  assert.doesNotMatch(names(false), /RELEASE_ENABLED|open pull requests/);
  assert.match(names(true), /RELEASE_ENABLED=true/);
  assert.match(names(true), /open pull requests/);
});

test("only plan- or visibility-dependent settings are optional", () => {
  const optional = plan("octo/app", { release: true }).filter((s) => s.optional).map((s) => s.name);
  assert.deepEqual(optional, ["private vulnerability reporting", "secret scanning and push protection"]);
});

test("merging is squash-only with the pull request title as the commit title", () => {
  const { body } = plan("octo/app", { release: false })[0];
  assert.deepEqual(
    [body.allow_squash_merge, body.allow_merge_commit, body.allow_rebase_merge, body.squash_merge_commit_title, body.delete_branch_on_merge],
    [true, false, false, "PR_TITLE", true],
  );
});

test("the repository argument is validated before any request", () => {
  assert.equal(isRepo("octo-org/demo.app_1"), true);
  for (const bad of ["octo", "octo/app/extra", "../x", "octo/app?x=1", "", undefined]) assert.equal(isRepo(bad), false, String(bad));
});
