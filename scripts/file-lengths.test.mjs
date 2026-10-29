// The file-length ceilings only go down.
//
//   pnpm test:scripts                           all of them (and part of `pnpm verify`)
//   node --test scripts/file-lengths.test.mjs   just this file
//
// `eslint-file-lengths.json` holds each file that was already longer than the
// `max-lines` budget to its own ceiling. ESLint enforces a ceiling from above;
// `scripts/file-lengths.mjs` enforces it from below, failing `pnpm lint` while
// one has slack and lowering it under `pnpm lint:prune`. These cover the
// decisions that script makes; the ESLint run that measures each file is the
// same one `pnpm lint` makes, checked by hand in the pull request that added
// it.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { pruned, slack } from "./file-lengths.mjs";

const BUDGET = 500;
const lengths = (entries) => new Map(Object.entries(entries));

describe("file-length ceilings", () => {
  it("leave a ceiling its file still fills alone", () => {
    const ceilings = { "a.ts": 900 };
    const found = lengths({ "a.ts": 900 });

    assert.deepEqual(pruned(ceilings, found, BUDGET), ceilings);
    assert.deepEqual(slack(ceilings, found, BUDGET), []);
  });

  it("lower a ceiling to a file that shrank", () => {
    const ceilings = { "a.ts": 900 };
    const found = lengths({ "a.ts": 850 });

    assert.deepEqual(pruned(ceilings, found, BUDGET), { "a.ts": 850 });
    assert.deepEqual(slack(ceilings, found, BUDGET), [
      "a.ts: ceiling 900, now 850 lines",
    ]);
  });

  it("drop a file that came within the budget, or is gone", () => {
    const ceilings = { "a.ts": 900, "gone.ts": 700, "small.ts": 600 };
    const found = lengths({ "a.ts": 900, "small.ts": BUDGET });

    assert.deepEqual(pruned(ceilings, found, BUDGET), { "a.ts": 900 });
    assert.deepEqual(slack(ceilings, found, BUDGET), [
      "gone.ts: no longer linted",
      `small.ts: ${BUDGET} lines, within the budget of ${BUDGET}`,
    ]);
  });

  it("never raise a ceiling: a file over it is ESLint's to report", () => {
    const ceilings = { "a.ts": 900 };
    const found = lengths({ "a.ts": 950 });

    assert.deepEqual(pruned(ceilings, found, BUDGET), ceilings);
    assert.deepEqual(slack(ceilings, found, BUDGET), []);
  });

  it("write the ceilings sorted by path, so a prune diffs cleanly", () => {
    const found = lengths({ "b.ts": 700, "a.ts": 800 });

    assert.deepEqual(
      Object.keys(pruned({ "b.ts": 700, "a.ts": 800 }, found, BUDGET)),
      ["a.ts", "b.ts"],
    );
  });
});
