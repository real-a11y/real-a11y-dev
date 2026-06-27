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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-empty-object-type -- declaration-merge into Vitest's matcher types
  interface Assertion<T = any> extends A11yMatchers<T> {}
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- declaration-merge into Vitest's matcher types
  interface AsymmetricMatchersContaining extends A11yMatchers {}
}
