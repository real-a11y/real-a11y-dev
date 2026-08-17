// Jest type augmentation — opt-in entry. Import once (e.g. in your setup file
// or a `*.d.ts`) so the matchers are typed on Jest's `expect`:
//
// ```ts
// import "@real-a11y-dev/testing/matchers/jest";
// ```
//
// This used to live in `./matchers` as an unconditional `declare global`, which
// made it impossible to opt OUT of. Vitest's `Assertion` extends
// `JestAssertion`, which extends `jest.Matchers` — so a Vitest consumer got the
// matcher names through the jest global AND through the `vitest` augmentation,
// with signatures TypeScript could not prove identical:
//
//     error TS2320: Interface 'Assertion<T>' cannot simultaneously extend
//     types 'JestAssertion<T>' and 'A11yMatchers<T>'.
//
// One error per matcher, in a file the consumer never wrote. It surfaced only
// under `skipLibCheck: false` AND TypeScript 7, which is why it shipped. The
// deeper cause — the two augmentations disagreeing on the matchers' return
// type — is fixed in `./matchers-vitest.ts`; splitting the entries is what
// stops a Vitest consumer from carrying Jest's augmentation at all.
//
// No `import "jest"`: the `jest` namespace is global from `@types/jest`, so
// unlike the Vitest entry there is no module to resolve. Types only — this file
// ships no runtime behaviour.

import type { A11yMatchers } from "./matchers.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace jest {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- declaration-merge into Jest's matcher types
    interface Matchers<R> extends A11yMatchers<R> {}
  }
}
