// What the docs say `pre-push` runs must be what `.husky/pre-push` runs.
//
//   pnpm test:scripts                               all of them (and part of `pnpm verify`)
//   node --test scripts/pre-push-claims.test.mjs    just this file
//
// WHY THIS IS A TEST AND NOT A CONVENTION. The hook shrank to the two
// build-free checks (it cannot outlast the push's connection to the remote —
// `.husky/pre-push` explains that at length), and five documents went on saying
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
// SO WHEN THE HOOK CHANGES, THIS FILE FAILS TWICE. That is the point. Every
// claim is BUILT from HOOK_COMMANDS rather than written out beside it, so
// editing the constant to match a new hook does not quiet the check — it
// re-points every claim at text the documents don't have yet, and they fail
// until someone actually updates them. Silencing this file means editing the
// documents, which is the work it exists to force.
//
// EVERY claim names the commands, including the two that used to argue the
// point negatively ("the pre-push hook does not run the gate", "is build-free").
// Those two were a hole: true however the build-free checks are spelled, so
// bumping HOOK_COMMANDS for a hook that gained a build left them matching, and
// matching is all this file asks. The command-list pin does not cover for them
// either — it stops complaining the moment the constant is updated, which is
// exactly what its failure message tells you to do. So they name the commands
// now, and a hook that grows a build falsifies every claim at once.
//
// WHAT IS NOT PINNED, deliberately: three test files explain a design choice by
// referring to the hook — `scripts/pr-risk.test.mjs` (why it strips git's
// repo-location variables), `scripts/vitest-tsx-coverage.test.mjs` (why it
// spawns node directly) and
// `packages/core/src/utils/realm-singleton.test.ts` (why one suite has a
// 20 s timeout). Those are rationales, not instructions to a contributor, so
// drift there misleads a reader of that one file instead of sending somebody to
// push unverified. All three were corrected alongside this file; none is a
// claim this guard keeps. Anything that tells a reader what pushing checks
// belongs in DOC_CLAIMS instead.

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
 * the claim it has to keep making: `before` + the command list + `after`.
 *
 * A claim is matched after collapsing whitespace, so re-wrapping the prose
 * around it is free; changing what it asserts is not. ONE EXCEPTION, and it
 * costs an afternoon to rediscover: in the two workflows the claim sits inside
 * a `#` comment block, and collapsing whitespace leaves those gutter markers
 * in the middle of the text. A claim that wraps there reads as
 * "…`pnpm lint` # so it cannot" and never matches. So keep each workflow claim
 * on one physical line — that is why these two are the shortest of the five.
 *
 * `after` IS THE POINT OF THE SPLIT, and it is why no entry may leave it empty.
 * A substring match is open at the right-hand end, so a bare
 * `` `pre-push` runs `pnpm format:check` `` would be satisfied by the sentence
 * "…runs `pnpm format:check` and `pnpm lint`" — a document still promising a
 * command the hook had lost. It cuts the other way too: with nothing pinned
 * after the list, "…and `pnpm lint` and then `pnpm verify`" reads as the whole
 * gate and matches just as happily, which is the original bug restored. Closing
 * the clause on both sides is what makes the match mean "this document
 * describes exactly these commands".
 */
const DOC_CLAIMS = [
  {
    file: "CLAUDE.md",
    before: "`pre-push` runs ",
    after: " — only the build-free checks",
  },
  {
    file: ".claude/skills/pr/SKILL.md",
    before: "the pre-push hook runs ",
    after: " only. Step 6",
  },
  {
    file: ".github/PULL_REQUEST_TEMPLATE.md",
    before: "the pre-push hook runs ",
    after: " only, so run it yourself)",
  },
  {
    file: ".github/workflows/publish.yml",
    before: "the pre-push hook runs ",
    after: ", so it runs",
  },
  {
    file: ".github/workflows/test.yml",
    before: "hook runs ",
    after: " only, so it cannot",
  },
];

/** The full pinned sentence fragment for one entry. */
const claimOf = ({ before, after }) => `${before}${COMMAND_LIST}${after}`;

/** Collapse every whitespace run to one space, so line wrapping is irrelevant. */
const normalize = (text) => text.replace(/\s+/g, " ");

/**
 * The commands `.husky/pre-push` actually runs.
 *
 * Comments and blank lines are dropped; everything else is a command. The hook
 * is a flat list of them today, and if it ever grows conditionals this returns
 * those lines verbatim and the assertion below fails — which is the right
 * outcome, since a hook with branches no longer runs a fixed set the
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

  it("closes every claim on both sides of the command list", () => {
    // Guards the guard twice over. An emptied DOC_CLAIMS makes the case below
    // pass vacuously, and this file would be watching nothing; an entry with an
    // empty `after` is watching only that the list appears SOMEWHERE in the
    // sentence, which both a shrunken hook and an appended over-claim satisfy.
    assert.ok(DOC_CLAIMS.length > 0, "DOC_CLAIMS is empty");

    for (const entry of DOC_CLAIMS) {
      for (const side of ["before", "after"]) {
        // Whitespace does not count as a pin. `normalize` collapses runs to a
        // single space, so `after: " "` asks only that SOMETHING follow the
        // list — which "…and `pnpm lint` and then `pnpm verify`" satisfies, the
        // over-claim this split exists to catch.
        assert.notEqual(
          entry[side].trim(),
          "",
          `${entry.file}'s claim has an empty or whitespace-only ` +
            `\`${side}\`. Both ends must be pinned to real words, or the ` +
            `match stops meaning "this document describes exactly these ` +
            `commands" — see the comment on DOC_CLAIMS.`,
        );
      }
    }
  });

  it("is stated by every document that describes it", async () => {
    for (const entry of DOC_CLAIMS) {
      // Not swallowed into a pass: a document that moved or was renamed is a
      // document this check is no longer watching.
      const text = normalize(await readFile(fromRepoRoot(entry.file), "utf8"));
      const claim = claimOf(entry);

      assert.ok(
        text.includes(normalize(claim)),
        `${entry.file} no longer contains the claim ` +
          `${JSON.stringify(claim)}. It is what tells a reader that pushing ` +
          `runs ${HOOK_COMMANDS.join(" and ")} and nothing heavier — restore ` +
          `it, or, if the hook itself changed, update HOOK_COMMANDS and this ` +
          `claim together.`,
      );
    }
  });
});
