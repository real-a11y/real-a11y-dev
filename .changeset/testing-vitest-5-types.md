---
"@real-a11y-dev/testing": minor
---

**Breaking: the `@real-a11y-dev/testing/matchers/vitest` types entry now needs Vitest 5 or newer.**

Vitest 5 changed its `Assertion` interface from `Assertion<T = any>` to `Assertion<R extends void | Promise<void> = void, T = unknown>`. The entry augments that interface, and an interface merge must repeat the original's type parameters, so the entry now declares the Vitest 5 shape. On Vitest 3 or 4, importing it reports `TS2428: All declarations of 'Assertion' must have identical type parameters`.

Nothing changes at runtime: `registerA11yMatchers` and every matcher behave as before on any Vitest version. If you are on Vitest 3 or 4 and can't upgrade yet, stay on the previous `@real-a11y-dev/testing` release, or skip the types import and cast `expect`. Vitest 5 itself requires Node.js 22.12 or newer.
