// The setup file a Vitest 3 or 4 project writes. The
// `import "…/matchers/vitest4"` line is types-only: it puts the matchers on
// Vitest's `expect`. `registerA11yMatchers` does the runtime wiring.
//
// Nothing in this project runs. It exists to be type-checked: see README.md.
import { expect } from "vitest";

import { registerA11yMatchers } from "@real-a11y-dev/testing/matchers";
import "@real-a11y-dev/testing/matchers/vitest4";

registerA11yMatchers(expect);
