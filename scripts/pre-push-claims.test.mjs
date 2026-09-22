// What the docs say `pre-push` runs must be what `.husky/pre-push` runs.
//
//   pnpm test:scripts                               all of them (and part of `pnpm verify`)
//   node --test scripts/pre-push-claims.test.mjs    just this file
//
// WHY THIS IS A TEST AND NOT A CONVENTION. The hook shrank to the two
// build-free checks (it cannot outlast the push's connection to the remote —
// `.husky/pre-push` explains that at length), and four documents went on saying
// it runs the whole gate. That drift is silent in the worst direction: nothing
// fails, and a contributor or agent who believes the gate already ran pushes
// without running it. It reads as diligence right up to the moment CI
// disagrees, and it has already produced a false "verified" claim in a pull
// request body. A hook that quietly promises less than the docs claim is not
// something a reviewer can see by reading either half alone.
//
// EXACT MATCH, not "parse the prose". The claims below are compared as literal
// strings, because a scanner clever enough to read English attributions is a
// scanner that can mis-read one — and it would fail the same way the bug does,
// by quietly reporting that all is well. The hook side is pinned the same way:
// one short list, checked against the file, no shell parsing.
//
// SO WHEN THE HOOK CHANGES, THIS FILE FAILS TWICE. That is the point. The
// claims that quote the command list are BUILT from HOOK_COMMANDS rather than
// written out beside it, so editing the constant to match a new hook does not
// quiet the check — it re-points every claim at text the documents don't have
// yet, and they fail until someone actually updates them. Silencing this file
// means editing the documents, which is the work it exists to force.
//
// The two claims that name no command are negative ones: they say the hook does
// not run the gate and is build-free, which stays true however the two
// build-free checks are spelled, and stops being true the moment the hook gains
// a build — the case the command-list pin catches first.
//
// WHAT IS NOT PINNED, deliberately: `scripts/pr-risk.test.mjs` and
// `scripts/vitest-tsx-coverage.test.mjs` each explain a design choice by
// referring to the hook. Those are rationales, not instructions to a
// contributor, so drift there misleads a reader of that one file instead of
// sending somebody to push unverified. They were corrected alongside this file;
// they are not claims this guard keeps.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

/** Repo-root-relative, as a URL — a Windows path pasted into one is not a URL. */
const fromRepoRoot = (path) => new URL(`../${path}`, import.meta.url);

/**
 * Every command `.husky/pre-push` runs, in order.
 *
 * Deliberately short. Both entries are build-free, which is what keeps the hook
 * inside the remote's receive-pack timeout; anything needing a build belongs in
 * CI's `Verify` step instead.
 */
const HOOK_COMMANDS = ["pnpm format:check", "pnpm lint"];

/**
 * The command list as the documents spell it: `` `pnpm format:check` and
 * `pnpm lint` ``.
 *
 * Derived, not repeated, so that a hook change cannot be absorbed by editing
 * HOOK_COMMANDS alone — see the header. A third command would read "a and b and
 * c", which is worth rephrasing in the documents and here together.
 */
const COMMAND_LIST = HOOK_COMMANDS.map((command) => `\`${command}\``).join(
  " and ",
);

/**
 * Documents that tell a reader what pushing does or does not check, each with
 * the claim it has to keep making.
 *
 * A claim is matched after collapsing whitespace, so re-wrapping the prose
 * around it is free; changing what it asserts is not.
 */
const DOC_CLAIMS = [
  { file: "CLAUDE.md", claim: `\`pre-push\` runs ${COMMAND_LIST}` },
  {
    file: ".claude/skills/pr/SKILL.md",
    claim: `the pre-push hook runs ${COMMAND_LIST} only`,
  },
  {
    file: ".github/PULL_REQUEST_TEMPLATE.md",
    claim: "the gate CI runs; the pre-push hook does not",
  },
  {
    file: ".github/workflows/publish.yml",
    claim: "the pre-push hook is build-free",
  },
];

/** Collapse every whitespace run to one space, so line wrapping is irrelevant. */
const normalize = (text) => text.replace(/\s+/g, " ");

/**
 * The commands `.husky/pre-push` actually runs.
 *
 * Comments and blank lines are dropped; everything else is a command. The hook
 * is a flat list of them today, and if it ever grows conditionals this returns
 * those lines verbatim and the assertion below fails — which is the right
 * outcome, since a hook with branches no longer runs a fixed set that four
 * documents can describe in one clause.
 */
async function hookCommands() {
  const source = await readFile(fromRepoRoot(".husky/pre-push"), "utf8");
  return source
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
}

describe("documented pre-push scope", () => {
  it("matches what the hook runs", async () => {
    assert.deepEqual(
      await hookCommands(),
      HOOK_COMMANDS,
      "`.husky/pre-push` no longer runs exactly the commands this file pins. " +
        "Update HOOK_COMMANDS — which will then fail the claim case below until " +
        "every document in DOC_CLAIMS is updated too, each of which tells a " +
        "reader what pushing checks. Leaving them stale is how a contributor " +
        "comes to believe the full gate ran when it did not.",
    );
  });

  it("is stated by every document that describes it", async () => {
    // Guards the guard: an emptied DOC_CLAIMS would make the loop below pass
    // vacuously, and this file would be watching nothing.
    assert.ok(DOC_CLAIMS.length > 0, "DOC_CLAIMS is empty");

    for (const { file, claim } of DOC_CLAIMS) {
      // Not swallowed into a pass: a document that moved or was renamed is a
      // document this check is no longer watching.
      const text = normalize(await readFile(fromRepoRoot(file), "utf8"));

      assert.ok(
        text.includes(normalize(claim)),
        `${file} no longer contains the claim ${JSON.stringify(claim)}. It is ` +
          `what tells a reader that pushing runs ${HOOK_COMMANDS.join(" and ")} ` +
          `and nothing heavier — restore it, or, if the hook itself changed, ` +
          `update HOOK_COMMANDS and this claim together.`,
      );
    }
  });
});
