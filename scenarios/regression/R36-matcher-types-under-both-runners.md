---
id: R36
suite: regression
scenario: "Testing pkg — the matcher TYPES compile under Vitest and Jest, with skipLibCheck off"
area: Packaging
type: Manual
priority: P1
status: Active
validFrom: "testing ≥ 0.1.0-beta.15 for the row; `./matchers/jest`, `./matchers/jest-globals` and the removal of the unconditional global ship in the FIRST release after 0.1.0-beta.15. On 0.1.0-beta.15 and earlier neither jest entry exists — steps 2 and 3 fail to RESOLVE, and step 1 reproduces the TS2320 collision rather than failing the test. That is the old behaviour, not a fail. Everything here is checked with `tsc --noEmit`; no test runner executes. TWO conditions have to hold together or the defect is invisible, and both are recorded here because getting either wrong produces a green run that proves nothing: `skipLibCheck: false`, and **TypeScript 7** — 5.6 and 5.9 do not report the collision at all, on the same project and the same package."
validUntil: ""
expected: "a Vitest consumer and both Jest consumer shapes each get every matcher typed, with zero errors under `skipLibCheck: false` on TypeScript 7; importing `./matchers` alone augments no runner's `expect`"
twin: D5
covers:
  - packages.@real-a11y-dev/testing
notion: ""
---

## Steps

Throwaway TypeScript projects, each installing the packed tarball, each with
**`skipLibCheck: false`**, `strict: true` and **TypeScript 7**. No test needs to
run — the whole scenario is `npx tsc --noEmit`.

1. **Vitest shape** — `import "@real-a11y-dev/testing/matchers/vitest"` plus
   `registerA11yMatchers(expect)`, with `vitest` installed and `@types/jest`
   absent. Call all seven matchers, and one `.not`
2. **Jest, global `expect`** — the `@types/jest` shape, no import of `expect` at
   all, plus `import "@real-a11y-dev/testing/matchers/jest"`. Same eight call sites
3. **Jest, imported `expect`** — `import { expect } from "@jest/globals"` plus
   `import "@real-a11y-dev/testing/matchers/jest-globals"`. Same eight call sites.
   Then swap in `./matchers/jest` and confirm it does **not** cover this shape
4. **No augmentation entry imported**, in all three projects: import only
   `@real-a11y-dev/testing/matchers` and call `expect(el).toHaveValidLandmarks()`
5. **Two entries imported at once** in one Vitest project, and separately both
   Jest entries in one Jest project — the shape a monorepo reaches by accident
   when a shared setup file serves two runners
6. Pass a wrong argument on purpose: `toHaveTabSequence("button")` where a
   `string[]` is required, and `toMatchA11yContract()` with no contract
7. Repeat 1–3 with `"moduleResolution": "bundler"` as well as `"node16"`
8. Re-run 1 on **TypeScript 5.9**, changing nothing else
9. Read the RETURN type in each shape: `const x: 1 = expect(el).toHaveValidLandmarks()`
   and read what the error says the actual type is

## Expected

- **1** — zero errors. This is the case that regressed: the package shipped an
  unconditional `declare global { namespace jest }`, Vitest's `JestAssertion`
  extends `jest.Matchers`, and `Assertion` extends both `JestAssertion` and
  `A11yMatchers` — so every matcher name arrived twice with return types
  TypeScript could not prove identical. `TS2320` ×7, reported at
  `matchers-vitest.d.ts(5,15)`, inside `node_modules`, in a file the consumer
  never wrote. Note the trigger is our global reaching `jest.Matchers`, NOT the
  presence of `@types/jest` — the project that found this has `jest` installed
  and no `@types/jest` at all
- **2** — zero errors, and all seven matchers resolve. If `./matchers/jest` is
  missing from either `tsup` entries or the `exports` map, this is where it
  shows: a subpath that resolves to nothing
- **3** — zero errors with `./matchers/jest-globals`, and one `TS2339` per call
  site with
  `./matchers/jest` — "Property 'toHaveNoUnlabeledInteractive' does not exist".
  Jest has TWO `expect`s with two separate type surfaces: the global one typed
  by `@types/jest` as `jest.Matchers`, and the imported one typed as `Matchers`
  from `@jest/expect`. A `namespace jest` merge reaches only the first, which is
  why this needs its own entry — the same split `@testing-library/jest-dom`
  ships. Note the old unconditional global did not cover this shape either: it
  is a gap this fix closes, not one it opened
- **4** — the matchers must **not** type. This is the point of making the
  augmentations opt-in, and it is what an existing Jest consumer feels as the
  breaking change: they add one import line. A pass here means the global crept
  back and 1 is failing again
- **5** — zero errors, in both. This is the step that proves the fix went deep
  enough rather than just moving the collision somewhere the default consumer
  no longer stands. Opt-in alone would NOT have achieved this: `matchers-jest.ts`
  carries the same `declare global` block that used to live in `./matchers`, so
  loading it beside `./matchers/vitest` reconstitutes the old pairing exactly.
  It compiles because the return types now agree — see 9
- **6** — errors, naming the parameter. Read the message: argument checking
  survives even in the collided state, so an exit code alone tells you nothing
  about whether the augmentation is healthy
- **7** — both resolutions agree. The `exports` map carries `types` before
  `import`/`require` in each entry; a subpath whose `types` condition is ordered
  wrong resolves under one and not the other
- **8** — **silent**, and that is not a pass. TypeScript 5.9 does not report the
  collision on a project where 7 reports it seven times, same package, same
  config. Anything here run on 5.x proves nothing at all, which is most of why
  this shipped
- **9** — `void`, in every shape, and that is the actual fix. `A11yMatchers`'
  type parameter is the matcher's RETURN type, but the Vitest entry was passing
  it `T`, the SUBJECT type — so `toHaveValidLandmarks()` was declared returning
  `HTMLElement` on our side and `void` on Vitest's, which inherits
  `jest.Matchers<void, T>`. TS2320 says "not identical" because they were not
  identical. Opt-in decides who loads which augmentation; agreeing on `void` is
  what stops the two from conflicting when something loads both

## Why this exists

A type-only defect is invisible to every runtime test in this repo, and it was
invisible to `tsc` too. Two independent silencers had to be lifted before it
said anything: `skipLibCheck: true`, the default in most starters and in this
repo's own examples, and TypeScript 5.x, which stays quiet about this even with
`skipLibCheck: false`. It took TypeScript 7 to report it. The row records both
conditions because a green run under either one is worthless evidence.

What `skipLibCheck: true` does here is subtler than "hides the error", and the
subtlety is why step 6 exists. It does not degrade anything to `any` — argument
checking survives, and the matcher still resolves, just to the WRONG return
type: the Jest declaration wins the merge and every matcher comes back `void`.
So the suppressed state is not "untyped", it is "typed as the thing the two
declarations disagreed about", which reports nothing and looks entirely healthy
from the call site.

The asymmetry that caused it looked like a saving. Vitest's augmentation had to
be opt-in, because `declare module "vitest"` forces module resolution on a
consumer who has no `vitest` installed. Jest's needs no resolution at all, so
shipping it unconditionally cost nothing — except the ability to decline it,
which is the one thing a Vitest consumer needed.

Step 3 is the same lesson one level down. "Jest's `expect`" is two different
types, and the free-looking global covered only one of them, so the Jest half of
this was half-built before and after — the fix is what made it whole, and it is
`@jest/expect` that gets augmented, never `@jest/globals`, which merely
re-exports an `expect` typed elsewhere.

Three things guard the repo half of this now, and none of them can replace the
steps above:

- `packages/testing/src/matchers-entry.test.ts` — `./matchers` carries no
  augmentation, each runner entry carries exactly its own and no runtime code,
  and the entry list and the `exports` map are the same set in both directions.
  It reads source and config; it does not compile anything
- `examples/testing-jest` and `examples/testing-vitest` now have `typecheck`
  scripts, so `pnpm verify` compiles a real consumer of each entry. Delete the
  augmentation import from either setup file and it fails with `TS2339`. The
  Jest example previously ran `ts-jest` in transpile-only mode — `isolatedModules`
  in its tsconfig disables the language service — so it was checking nothing at
  all, and a deliberate `const n: number = "nope"` passed
- `packages/testing`'s own `tsc` compiles all three entries in ONE program, so
  it is permanently in the "imported two augmentations" shape. That is a useful
  accident: it means step 5's condition is checked on every commit, and it is
  why the return types agreeing is load-bearing rather than cosmetic

All three run on TypeScript 5.x, which reports none of the TS2320 class. That is
the gap the steps above exist to fill, and why this row is Manual.

## Notes

Minimal reproduction of the regressed state — a Vitest project on
`testing ≤ 0.1.0-beta.15`, `skipLibCheck: false`, TypeScript 7. This whole file
is the reproduction; nothing else is needed, and no test runs:

```ts
import { expect } from "vitest";
import { registerA11yMatchers } from "@real-a11y-dev/testing/matchers";
import "@real-a11y-dev/testing/matchers/vitest";

registerA11yMatchers(expect);
// node_modules/@real-a11y-dev/testing/dist/matchers-vitest.d.ts(5,15):
// error TS2320: Interface 'Assertion<T>' cannot simultaneously extend types
// 'JestAssertion<T>' and 'A11yMatchers<T>'.   ×7
```

Swapping only the TypeScript version to 5.9 in that same project silences all
seven. Swapping only the package to the fixed one silences all seven. Both were
checked separately, because either alone would look like the fix.

Step 3's second half, in a Jest project, with `./matchers/jest` where
`./matchers/jest-globals` belongs — the pairing the docs used to imply:

```ts
import { expect } from "@jest/globals";
import "@real-a11y-dev/testing/matchers/jest";
expect(el).toHaveValidLandmarks();
// error TS2339: Property 'toHaveValidLandmarks' does not exist on type
// 'Matchers<void, HTMLElement> & SnapshotMatchers<…> & …'
```
