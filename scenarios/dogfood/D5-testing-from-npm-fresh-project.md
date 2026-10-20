---
id: D5
suite: dogfood
scenario: "Testing package from npm in a fresh vitest + Playwright project"
area: Testing
type: Automated
priority: P0
status: Active
validFrom: "testing ≥ 0.1.0-beta.11 from the registry on the `beta` tag. Follow only the published docs — gaps you have to fill from memory ARE the finding"
validUntil: ""
expected: "a brand-new project can install, follow the docs, and get a passing a11y test against a real page in minutes; the accessible page passes and every deliberate defect fails with a message that names it"
twin:
  - R12
  - R13
  - R15
  - R33
  - R34
  - R36
  - R37
covers:
  - packages.@real-a11y-dev/testing
notion: "https://app.notion.com/p/3aa1c354b0b5816e80fbe1e24385353b"
---

## Steps

Start from **nothing** — a fresh directory, following only the published docs. Do not consult
the monorepo; if a step is missing from the docs, that is the finding.

1. `npm init -y`, then install exactly what the quick start names — today
   `@real-a11y-dev/testing@beta`, `vitest`, `jsdom`, and `@playwright/test` for the
   browser half
2. Follow the quick-start on real-a11y.dev exactly as written
3. Write tests against a page **you serve on localhost**, built the way real products
   ship rather than as a fixture of the failure you expect:
   - an accessible page that uses the everyday patterns — a logo link
     `<a href="/"><img alt="…"></a>`, a button whose only content is an `<img alt>`, a
     `role="status"` region — and that is served with a real `Content-Security-Policy`
     response header for the Playwright half;
   - a legacy page with the defects real pages carry (an image link with no `alt`, a
     placeholder-only field, a heading skip, no `<main>`);
   - one assertion scoped to a **subtree** while the status region is mounted, and one
     while an unrelated modal is open.

   Optionally add one test against `https://real-a11y.dev` — a live site changes with
   every deploy, so it can't carry step 5
4. Run it
5. Add a snapshot assertion and run with `CI=1` (so a missing snapshot fails instead of
   being written), in shuffled order, and once more on a second Node major — confirm it's
   stable
6. Make each of the matchers fail deliberately, plus one failure through the Playwright
   handle, and read every message — not just the one with the best output
7. Do the same in a **Jest** project, using the `/matchers` entry from a plain CommonJS
   `jest.setup.js` with no transform
8. `tsc --noEmit` with `strict` and `skipLibCheck: false` against `vitest@latest` (twin:
   R36)
9. Time the whole thing from empty directory to green test

## Expected

- Every documented step works as written, against the **just-published** versions
- A brand-new project reaches a passing a11y test in **minutes**, not an afternoon
- **3** — the accessible page passes every assertion, logo link and icon button included,
  and a subtree assertion reports only what is inside the subtree. On testing
  0.1.0-beta.19 both fail — an `<img alt>` never names its link, and a status region or
  modal elsewhere silently widens the root — which are the known defects the beta.19
  dogfood filed, not new ones
- Snapshots are stable across runs
- Every deliberate failure produces a message that names the offending element — someone
  new to the library should be able to act on it without reading source. Through
  Playwright, the rejection is still an `A11yAssertionError`
- Jest works as well as Vitest, CommonJS setup included
- **8** — zero errors on the Vitest major `npm i vitest` installs today. On testing
  0.1.0-beta.19, Vitest 5 reports `TS2428` from `matchers-vitest.d.ts` (known defect)

## Why this exists

This is the adoption path. Everything else in both suites tests whether the code works; this
tests whether a stranger can _get it working_ from the docs alone — which is the only version of
"works" that grows usage.

Two rules make it meaningful:

- **Don't fill gaps from memory.** If the docs omit a peer dependency or a config line, note it
  rather than working around it. Working around it is precisely how a broken quick-start survives
  release after release — the only people who run it already know the answer.
- **Time it** (9). "It works eventually" and "it works in five minutes" are different products,
  and the second one is the claim the docs make.

Step 3 was rebuilt after the beta.19 dogfood. "An accessible page passes" is vacuous on a page
with none of the patterns real pages use: that run's accessible page failed on its own logo
link, because the DOM tree never reads a child `<img alt>` into a link's name — a defect at
least as old as beta.15 that every earlier run of this row missed. Scoping to a subtree had
the same blind spot, since a status region outside the root silently widens it to the whole
page, which turns a contract into a false pass. Step 5's "run twice" never failed either: with
no `CI=1`, a missing snapshot is simply written. And step 6 let a runner stop at the matcher
with the best message, which is how `toBeValidA11yTree`'s locator-free output went unread.
