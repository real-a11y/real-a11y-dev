// Jest type augmentation for the MODERN import — opt-in entry, the companion to
// `./matchers/jest`:
//
// ```ts
// import { expect } from "@jest/globals";
// import "@real-a11y-dev/testing/matchers/jest-globals";
// ```
//
// Two entries because Jest has two `expect`s with two separate type surfaces,
// and augmenting one does nothing for the other:
//
//   - the GLOBAL `expect`, typed by `@types/jest` as `jest.Matchers` — that is
//     `./matchers/jest`
//   - the IMPORTED `expect` from `@jest/globals`, typed as `Matchers` from
//     `@jest/expect` — this file
//
// `@testing-library/jest-dom` splits its own augmentation the same way and for
// the same reason: `declare module "@jest/expect"` has to RESOLVE that module,
// so folding it into `./matchers/jest` would hand `TS2307` to anyone typing
// their suite with `@types/jest` alone.
//
// The type parameters must match `expect`'s own declaration exactly — including
// the unused `T` and the default — or the interfaces do not merge:
// "All declarations of 'Matchers' must have identical type parameters."
//
// Types only; this file ships no runtime behaviour.

// The empty type-import is what compiles THIS file: an augmentation target has
// to be a module the program already contains, and resolving the specifier is
// not the same thing. Without it `tsc` resolves `@jest/expect` and rejects the
// augmentation anyway — "TS2664: Invalid module name in augmentation, module
// '@jest/expect' cannot be found", which reads like a missing dependency and is
// not one.
//
// It does NOT survive into the shipped declaration; tsup's dts rollup drops it,
// exactly as it drops `import "vitest"` from the Vitest entry. Consumers are
// fine without it because their own `@jest/globals` import puts `@jest/expect`
// in their program — which is also why `@jest/expect` is an optional peer here
// rather than only a devDependency, so a non-hoisted install cannot leave the
// augmentation pointing at a module the consumer's compiler can't see.
import type {} from "@jest/expect";

import type { A11yMatchers } from "./matchers.js";

declare module "@jest/expect" {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- declaration-merge into @jest/expect's matcher types
  interface Matchers<
    R extends void | Promise<void>,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- part of the signature being merged into; drop it and the interfaces stop merging
    T = unknown,
  > extends A11yMatchers<R> {}
}
