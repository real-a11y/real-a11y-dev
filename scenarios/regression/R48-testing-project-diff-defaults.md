---
id: R48
suite: regression
scenario: "Testing pkg — `a11yDiff` defaults set once in a setup file reach every diff, under Jest (CJS) and Vitest (ESM)"
area: Testing
type: Manual
priority: P1
status: Active
validFrom: "testing ≥ 0.1.0-beta.25. On 0.1.0-beta.24 or earlier `configureA11y` is not exported and `registerA11yMatchers` ignores a second argument, so every diff prints its `childIds` lines: that is the old behaviour, not a fail. Run it against a packed tarball, not the workspace: from source the two entries share one module and the failure this guards can't happen."
validUntil: ""
expected: "a default passed to `registerA11yMatchers(expect, { diff })` in the setup file applies to `a11yDiff` imported from `@real-a11y-dev/testing`, in Jest and in Vitest; a call's own option wins for that call only and keeps the project's `redact`; `flow().expectChanges` strings compare against the same text"
covers:
  - packages.@real-a11y-dev/testing
---

## Steps

Pack `@real-a11y-dev/testing` (`pnpm --filter @real-a11y-dev/testing pack`) and
install the tarball into two scratch projects: one on **Jest** with
`testEnvironment: "jsdom"` and a `.js` (CommonJS) setup file, one on **Vitest**
with `environment: "jsdom"`.

1. In each setup file, register with defaults:

   ```js
   registerA11yMatchers(expect, {
     diff: { childIds: false, redact: [/\d{2}:\d{2}/] },
   });
   ```

2. In a test, with `a11yDiff`, `capture` and `flow` imported from
   `@real-a11y-dev/testing` (`require` under Jest):

   ```js
   document.body.innerHTML = `<main><ul aria-label="Todo"><li>a</li></ul></main>`;
   const main = document.querySelector("main");
   const before = capture(main);
   main.querySelector("ul").insertAdjacentHTML("beforeend", "<li>Ship at 12:30</li>");

   console.log(a11yDiff(before, main).text);
   console.log(a11yDiff(before, main, { childIds: true }).text);
   ```

3. A `flow()` whose click adds an option to an empty listbox, ending in
   `.expectChanges('+ option "Spain"')` with no `childIds` line.
4. Remove the second argument from the setup file and run step 2 again.

## Expected

- **2** — the first diff prints only `+ listitem "Ship at [REDACTED]"`. The second
  adds `~ list "Todo": childIds 1 child → 2 children` and is still redacted
- **3** — the flow passes: the string is compared against the diff printed with
  the project's `childIds: false`
- **4** — both diffs print the `childIds` line and the time unredacted, as before
- Jest and Vitest agree on every line

## Why this exists

`testing` builds each entry in ESM and CJS, and CJS shares no chunk between
entries: `dist/matchers.cjs` and `dist/index.cjs` each carry their own copy of
the module holding the defaults. A Jest setup file registers through the first
and the test diffs through the second, so defaults kept in module scope would
silently never apply: no error, just snapshots recorded the built-in way. The
defaults live in a realm-wide slot (`realmSingleton`) for that reason, and
`e2e/built-config.test.ts` checks it on the built files. This row checks it
where a consumer meets it: through the `exports` map of an installed tarball,
under both runners.
