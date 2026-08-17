---
"@real-a11y-dev/testing": minor
---

Make every matcher type augmentation opt-in, adding `./matchers/jest` and `./matchers/jest-globals`

`@real-a11y-dev/testing/matchers` shipped an unconditional
`declare global { namespace jest }`. Jest consumers got the matcher types for
free — and Vitest consumers got them whether they wanted them or not, because
Vitest's `Assertion` extends `JestAssertion`, which extends `jest.Matchers`. So
a Vitest project that imported `./matchers` and `./matchers/vitest`, as the docs
instruct, declared every matcher name twice from two augmentations TypeScript
could not prove identical:

```
error TS2320: Interface 'Assertion<T>' cannot simultaneously extend types
'JestAssertion<T>' and 'A11yMatchers<T>'.
```

One error per matcher, reported against a file inside `node_modules`. Two
things kept it quiet: it needs `skipLibCheck: false`, and it needs TypeScript 7
— 5.x does not report it on the same project and the same package.

The underlying cause was a type-parameter mix-up in the Vitest entry, which is
fixed too: `A11yMatchers`' parameter is the matcher's RETURN type, and the entry
was passing it the SUBJECT type, so the matchers were declared returning
`HTMLElement` on our side and `void` on Vitest's, which inherits
`jest.Matchers<void, T>`. "Not identical" was a correct diagnosis. They agree on
`void` now — matching what both runners say about their own matchers — so
loading more than one entry is redundant rather than an error.

Jest's augmentation now lives in its own entry, mirroring `./matchers/vitest`.
There are two, because Jest has two `expect`s with separate type surfaces:

- **`./matchers/jest`** — the global `expect`, typed by `@types/jest`
- **`./matchers/jest-globals`** — `import { expect } from "@jest/globals"`,
  typed by `@jest/expect`. The old unconditional global never covered this
  shape at all, so this half is a gap closed rather than one opened

None of the three ships runtime code; `registerA11yMatchers(expect)` is still
what installs the matchers.

## Breaking change

**Anyone whose matcher types came from the free global must add one import** —
alongside the `registerA11yMatchers` call in their setup file:

```ts
import { registerA11yMatchers } from "@real-a11y-dev/testing/matchers";
import "@real-a11y-dev/testing/matchers/jest"; // ← add this
// …or "…/matchers/jest-globals" if you import `expect` from "@jest/globals"
// …or "…/matchers/vitest" on Vitest

registerA11yMatchers(expect);
```

That is every Jest + TypeScript user, and also **Vitest users who never
imported `./matchers/vitest`** — the removed jest global reached Vitest's
`Assertion` through `JestAssertion`, so those projects type-checked without it
and will now report `TS2339` on each matcher. Vitest setups that already carry
the documented `./matchers/vitest` line need no change and lose the TS2320
errors.

In every case the matchers still RUN — registration is unchanged and no
behaviour moved. Only the types are affected.

One more type-level change, which no call site should notice: matchers typed
through `./matchers/vitest` now return `void` rather than the subject type.
