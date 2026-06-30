// Vitest setup file — registers the custom a11y matchers and the snapshot
// serializer once for the whole suite. Wired in via `setupFiles` in
// vitest.config.ts.
//
// The `import "…/matchers/vitest"` line is types-only: it augments Vitest's
// `expect` so `toHaveNoUnlabeledInteractive()`, `toHaveTabSequence()`, etc. are
// typed. `registerA11yMatchers` does the runtime wiring.
import { expect } from "vitest";

import { registerA11yMatchers } from "@real-a11y-dev/testing/matchers";
import "@real-a11y-dev/testing/matchers/vitest";

registerA11yMatchers(expect);
