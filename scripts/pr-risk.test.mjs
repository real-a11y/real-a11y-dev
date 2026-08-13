// What the rubric grades, asserted rather than described.
//
//   pnpm test:scripts                        all of them (and part of `pnpm verify`)
//   node --test scripts/pr-risk.test.mjs     just this file
//
// `test:scripts` is `cd scripts && node --test`, and the `cd` is load-bearing:
// `node --test <dir>` scans that directory on Node 20 but treats it as a FILE TO
// RUN from Node 21 on, so the tidier-looking `node --test scripts/` died with
// `Cannot find module …/scripts` on the CI matrix's Node 22 legs while passing
// every local run and both Node 20 legs. With no positional argument, every
// version discovers test files under the working directory the same way.
//
// BLACK BOX, on purpose. `pr-risk.mjs` is a script, not a module — it collects
// facts and prints at import time — so there is nothing to import and stub. Each
// case therefore builds a throwaway git repository, commits a base, commits a
// diff on top, and runs the real rubric against it with `--repo`. That is the
// same entry point `.github/workflows/pr-risk.yml` uses, so a case passing here
// is a case that passes in CI rather than one that passes against a seam.
//
// It also means these tests cost git processes, not microseconds. Keep the cases
// few and make each one carry a decision somebody could otherwise silently
// reverse — the point is that a classification cannot be deleted without a red
// test, not that every path in the rubric has a row here.
//
// Node's own test runner, and node core only: this file sits in the tree that
// `pr-risk.yml` extracts and runs with no `pnpm install`, and a devDependency
// import here would be one more thing that can break that job.

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);

const RUBRIC = fileURLToPath(new URL("./pr-risk.mjs", import.meta.url));

/**
 * The environment with git's repo-location variables STRIPPED.
 *
 * `pnpm verify` runs from the `pre-push` hook, and git exports `GIT_DIR` and
 * `GIT_INDEX_FILE` into a hook's environment. Those beat `cwd` — so every
 * `git init` here silently addressed the real repository instead of its own
 * temp directory, and the whole suite died on `fatal: this operation must be run
 * in a work tree`. Green from a plain shell, red from the hook that gates the
 * push: the one place a fixture must not inherit ambient state.
 *
 * The identity pairs go too. `GIT_AUTHOR_NAME` and friends outrank the `-c`
 * flags below, so a contributor who exports them would otherwise author these
 * throwaway commits.
 */
const HERMETIC_ENV = { ...process.env };
for (const name of [
  "GIT_DIR",
  "GIT_COMMON_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_CEILING_DIRECTORIES",
  "GIT_NAMESPACE",
  "GIT_PREFIX",
  "GIT_AUTHOR_NAME",
  "GIT_AUTHOR_EMAIL",
  "GIT_AUTHOR_DATE",
  "GIT_COMMITTER_NAME",
  "GIT_COMMITTER_EMAIL",
  "GIT_COMMITTER_DATE",
]) {
  delete HERMETIC_ENV[name];
}

/** A repo whose config cannot depend on whose machine is running the suite. */
async function git(cwd, args) {
  await run(
    "git",
    [
      "-c",
      "user.name=pr-risk test",
      "-c",
      "user.email=pr-risk@example.invalid",
      "-c",
      "commit.gpgsign=false",
      // Windows: without this, git rewrites line endings and warns on every
      // add, which is noise in a failure report and nothing this asserts.
      "-c",
      "core.autocrlf=false",
      ...args,
    ],
    { cwd, env: HERMETIC_ENV },
  );
}

let root;

before(async () => {
  root = await mkdtemp(join(tmpdir(), "pr-risk-"));

  // Refuse to run if anything still redirects git, and refuse BEFORE the first
  // `git init` rather than after.
  //
  // This is not defensive dressing. `git init` under a stray `GIT_DIR`
  // REINITIALISES the repository that variable names — and with no work tree in
  // scope it writes `core.bare = true` into that repo's shared config, which for
  // a repo with linked worktrees breaks the main checkout and every worktree at
  // once, for every session using them. That is what happened here, from the
  // `pre-push` hook, before `HERMETIC_ENV` above existed.
  //
  // So the check is a probe rather than a list: stripping the variables I know
  // about cannot cover one a future git adds, but "git already resolves a
  // repository in an empty directory" catches any of them. `GIT_CEILING_DIRECTORIES`
  // stops the ordinary upward walk, so a hit means redirection and not merely a
  // temp directory that happens to sit inside a checkout — which is harmless,
  // since `git init` would create a fresh repo there rather than touch the
  // ancestor.
  let redirected = null;
  try {
    const { stdout } = await run("git", ["rev-parse", "--absolute-git-dir"], {
      cwd: root,
      env: { ...HERMETIC_ENV, GIT_CEILING_DIRECTORIES: dirname(root) },
    });
    redirected = stdout.trim();
  } catch {
    // The expected path: a fresh temp directory is not a repository.
  }
  if (redirected) {
    throw new Error(
      `git resolves ${root} to the repository at ${redirected}. Something is ` +
        `still redirecting it, and \`git init\` would reinitialise that ` +
        `repository rather than build a fixture. Refusing to run.`,
    );
  }
});

after(async () => {
  // `maxRetries` because git may still hold a handle on Windows for a moment.
  await rm(root, { recursive: true, force: true, maxRetries: 3 });
});

let n = 0;

/**
 * Grade a diff: `files` is the set of paths this imaginary pull request adds.
 *
 * `seed` is committed first and never appears in the answer — the rubric diffs
 * against the merge base, so the base commit's own contents are invisible to it.
 * That is what lets a case name exactly the paths it is about.
 */
async function grade(files) {
  const dir = join(root, `case-${++n}`);
  await mkdir(dir, { recursive: true });

  await git(dir, ["init", "-q", "-b", "main"]);
  await writeFile(join(dir, "seed"), "base\n");
  await git(dir, ["add", "-A"]);
  await git(dir, ["commit", "-q", "--no-verify", "-m", "chore: seed"]);

  await git(dir, ["checkout", "-q", "-b", "topic"]);
  for (const path of files) {
    const file = resolve(dir, path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, "changed\n");
  }
  await git(dir, ["add", "-A"]);
  await git(dir, ["commit", "-q", "--no-verify", "-m", "chore: change"]);

  // Same stripped environment: the rubric runs its own git with `cwd: repoRoot`,
  // and an inherited `GIT_DIR` would point every one of those reads at the repo
  // this suite happens to be running inside rather than at the fixture.
  const { stdout } = await run(
    process.execPath,
    [RUBRIC, "--repo", dir, "--base", "main", "--format", "json"],
    { maxBuffer: 16 * 1024 * 1024, env: HERMETIC_ENV },
  );
  return JSON.parse(stdout);
}

const ruleIds = (result) => result.reasons.map((r) => r.id);
const evidenceFor = (result, id) =>
  result.reasons.find((r) => r.id === id)?.evidence ?? [];

describe("agent instruction grades as review policy", () => {
  it("grades the root CLAUDE.md 🔴 high, citing it by path", async () => {
    const result = await grade(["CLAUDE.md"]);

    assert.equal(result.tier, "high");
    assert.ok(
      ruleIds(result).includes("review-policy"),
      `expected review-policy to fire, got: ${ruleIds(result).join(", ") || "no rules"}`,
    );
    assert.deepEqual(evidenceFor(result, "review-policy"), ["CLAUDE.md"]);
  });

  it("says nothing about the path being unrecognised", async () => {
    // The state this replaced: no rule matched, so CLAUDE.md fell through to
    // "paths the rubric doesn't recognise (medium until one of us classifies
    // them)" — whose printed advice is to add the path to LOW_SHAPED, i.e. to
    // the list documented as harmless. Being cited by a rule is what keeps that
    // advice off a file that is anything but.
    const result = await grade(["CLAUDE.md"]);

    assert.deepEqual(result.unrecognised, []);
    assert.ok(!result.shape.includes("unrecognised"));
  });

  it("grades a nested CLAUDE.md the same — the anchor is the basename", async () => {
    // None exists today. The rule is anchored this way because Claude Code loads
    // a nested CLAUDE.md for the subtree it sits in, with the same force as the
    // root one, so the day somebody adds `packages/extension/CLAUDE.md` it must
    // not arrive graded as an unclassified path.
    const result = await grade(["packages/extension/CLAUDE.md"]);

    assert.equal(result.tier, "high");
    assert.deepEqual(evidenceFor(result, "review-policy"), [
      "packages/extension/CLAUDE.md",
    ]);
  });

  it("is not switched off by a capitalisation slip", async () => {
    // On macOS and Windows the read still resolves, so `Claude.md` keeps every
    // bit of its authority over agent sessions while a case-sensitive pattern
    // silently stops matching it. Same failure the `breaking` rule was fixed for
    // when `feat!:` fired and `Feat!:` did not.
    const result = await grade(["Claude.md"]);

    assert.equal(result.tier, "high");
    assert.deepEqual(evidenceFor(result, "review-policy"), ["Claude.md"]);
    assert.equal(result.ci.code, false);
  });

  it("grades it the same as the .claude/ skills it shares authority with", async () => {
    // The reason this file's classification is worth a test at all: the two
    // carry the same kind of authority over how agents behave here, and graded
    // apart, the one that is easier to edit is the one that gets less review.
    const skill = await grade([".claude/skills/pr/SKILL.md"]);
    const claudeMd = await grade(["CLAUDE.md"]);

    assert.equal(claudeMd.tier, skill.tier);
    assert.deepEqual(ruleIds(claudeMd), ruleIds(skill));
  });
});

describe("the basename anchor does not spread", () => {
  it("leaves ordinary root docs 🟢 low", async () => {
    const result = await grade(["README.md"]);

    assert.equal(result.tier, "low");
    assert.deepEqual(result.reasons, []);
    assert.ok(result.shape.includes("root docs"));
  });

  it("leaves a doc that merely contains the word 🟢 low", async () => {
    // `(^|/)CLAUDE\.md$` rather than a bare `CLAUDE\.md`: without both anchors a
    // note about the file grades as the file.
    const result = await grade(["docs/my-CLAUDE.md", "docs/CLAUDE.md.bak.md"]);

    assert.equal(result.tier, "low");
    assert.deepEqual(result.reasons, []);
  });
});

describe("the CI axis classifies it too", () => {
  it("treats a CLAUDE.md-only diff as inert for the test matrix", async () => {
    // A different question from the tier, and both halves have to name the path:
    // 🔴 high to review, and incapable of changing what any test asserts. Left
    // out of CI_INERT it would run e2e, the example apps and Node 24 over a
    // paragraph of prose.
    const result = await grade(["CLAUDE.md"]);

    assert.equal(result.ci.code, false);
    assert.equal(result.ci.website, false);
    // "the one narrow leg", not "Node 20" — the version floor moves for reasons
    // that have nothing to do with this file, and a test that fails on that bump
    // teaches the person bumping it to edit the expectation without reading it.
    assert.equal(result.ci.matrix.node.length, 1);
  });

  it("still runs everything when real source moves alongside it", async () => {
    const result = await grade(["CLAUDE.md", "packages/core/src/index.ts"]);

    assert.equal(result.ci.code, true);
    assert.equal(result.tier, "high");
  });
});
