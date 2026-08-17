// Jest setup file — registers the custom a11y matchers and snapshot serializer
// once for the whole suite. Wired in via `setupFilesAfterEnv` in
// jest.config.cjs.
//
// Two imports, exactly as the Vitest example has: the runtime registration, and
// a types-only augmentation naming this runner. `./matchers/jest` is what makes
// `expect(el).toHaveValidLandmarks()` type-check.
import { registerA11yMatchers } from "@real-a11y-dev/testing/matchers";
import "@real-a11y-dev/testing/matchers/jest";

// `expect` is the Jest global provided in the test environment.
registerA11yMatchers(expect);
