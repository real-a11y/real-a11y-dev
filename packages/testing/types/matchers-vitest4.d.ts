// Vitest 3 and 4 type augmentation — opt-in entry, for a project that cannot
// move to Vitest 5 yet. Import it once (e.g. in your setup file or a `*.d.ts`)
// in place of `./matchers/vitest`:
//
// ```ts
// import "@real-a11y-dev/testing/matchers/vitest4";
// ```
//
// HAND-WRITTEN, and copied into `dist/` by `scripts/write-vitest4-types.mjs`,
// the last step of `pnpm build`, because nothing in this repo can compile it.
// An interface merge must repeat the original's type parameters exactly, or
// TypeScript reports TS2428, and this repo is on Vitest 5, whose
// `Assertion<R, T>` this declaration deliberately does not match. As a file
// under `src/` it would fail this package's own `tsc` and its dts build, which
// both see Vitest 5. `examples/testing-vitest4` compiles the built copy
// instead, against a real Vitest 4, with `skipLibCheck: false`.
//
// One file cannot serve both majors: its type parameters have to match one of
// them exactly. Merging into Vitest's `Matchers` instead does not escape that,
// because Vitest 5 changed `Matchers<T = any>` to `Matchers<R, T>` as well.
//
// Like `./matchers/vitest`, this ships no runtime behaviour: the `.js` and
// `.cjs` beside it are empty, so a setup file can import it either way.

import type { A11yMatchers } from "./matchers.js";

declare module "vitest" {
  // `T = any` mirrors Vitest 3's and 4's own `Assertion<T = any>`. Through
  // testing 0.1.0-beta.21 this was `./matchers/vitest` itself, until that entry
  // moved to Vitest 5's shape.
  //
  // `A11yMatchers<void>`, not `<T>`, for the reason `src/matchers-vitest.ts`
  // gives: `T` is the subject being asserted on, `A11yMatchers`' parameter is
  // the matcher's return type, and Vitest types every matcher as returning
  // `void`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-empty-object-type -- declaration-merge into Vitest's matcher types
  interface Assertion<T = any> extends A11yMatchers<void> {}
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- declaration-merge into Vitest's matcher types
  interface AsymmetricMatchersContaining extends A11yMatchers {}
}
