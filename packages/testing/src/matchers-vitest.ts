// Vitest type augmentation — opt-in entry. Import once (e.g. in your setup
// file or a `*.d.ts`) so the matchers are typed on Vitest's `expect`:
//
// ```ts
// import "@real-a11y-dev/testing/matchers/vitest";
// ```
//
// Kept separate from `./matchers` so Jest-only consumers never have to resolve
// the `vitest` module. The side-effect `import "vitest"` is types-only at use
// sites (the augmentation), and this file ships no runtime behaviour of its own.

import "vitest";

import type { A11yMatchers } from "./matchers.js";

declare module "vitest" {
  // `T = any` mirrors Vitest's own `Assertion` declaration — interface merges
  // require identical type parameters, defaults included.
  //
  // `A11yMatchers<void>`, NOT `<T>`. `T` is the SUBJECT type — the thing being
  // asserted on — while `A11yMatchers`' parameter is the matcher's RETURN type.
  // Vitest's own chain is `Assertion<T> extends JestAssertion<T>` and
  // `JestAssertion<T> extends jest.Matchers<void, T>`, so every matcher Vitest
  // types returns `void`. Passing `T` here declared `toHaveValidLandmarks():
  // HTMLElement` on one side and `: void` on the other, and TWO INTERFACES THAT
  // DISAGREE ON A RETURN TYPE is exactly what TS2320 reports:
  //
  //   Named property 'toBeValidA11yTree' of types 'JestAssertion<T>' and
  //   'A11yMatchers<T>' are not identical.
  //
  // With `void` they agree, so the two declarations coexist instead of
  // colliding — which is why a project that loads this entry AND the Jest one
  // (a shared setup file in a monorepo, or this package's own `tsc` program,
  // where both files are always compiled together) compiles cleanly.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-empty-object-type -- declaration-merge into Vitest's matcher types
  interface Assertion<T = any> extends A11yMatchers<void> {}
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- declaration-merge into Vitest's matcher types
  interface AsymmetricMatchersContaining extends A11yMatchers {}
}
