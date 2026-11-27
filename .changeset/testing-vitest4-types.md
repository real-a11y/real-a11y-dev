---
"@real-a11y-dev/testing": minor
---

New types-only entry, `@real-a11y-dev/testing/matchers/vitest4`, types the matchers on Vitest 3 and 4. `./matchers/vitest` merges into Vitest 5's `Assertion<R, T>`, and an interface merge must repeat the original's type parameters. On Vitest 3 or 4, whose `Assertion` is `Assertion<T = any>`, it reports TS2428 under `skipLibCheck: false`. Under `skipLibCheck: true` the error is suppressed and the matchers still type, through a merge TypeScript has rejected. The new entry declares the older shape, so a project that can't move to Vitest 5 yet, which needs Node.js 22.12+, can type-check cleanly:

```ts
// vitest.setup.ts, on Vitest 3 or 4
import { expect } from "vitest";
import { registerA11yMatchers } from "@real-a11y-dev/testing/matchers";
import "@real-a11y-dev/testing/matchers/vitest4"; // instead of …/matchers/vitest

registerA11yMatchers(expect);
```

Import the entry for the Vitest you have, not both: each fails with TS2428 on the other's major. Switch back to `./matchers/vitest` when you upgrade to Vitest 5. Like the other types entries, it ships no runtime code. Nothing changes for an existing import.
