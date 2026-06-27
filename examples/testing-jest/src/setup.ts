// Jest setup file — registers the custom a11y matchers and snapshot serializer
// once for the whole suite. Wired in via `setupFilesAfterEnv` in
// jest.config.cjs.
//
// Unlike Vitest, Jest needs no separate type-augmentation import: the matchers
// module ships a global `namespace jest { interface Matchers }` augmentation, so
// importing it here is enough for `expect(el).toHaveValidLandmarks()` to type.
import { registerA11yMatchers } from "@real-a11y-dev/testing/matchers";

// `expect` is the Jest global provided in the test environment.
registerA11yMatchers(expect);
