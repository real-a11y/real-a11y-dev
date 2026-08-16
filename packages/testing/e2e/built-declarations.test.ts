// Assertions on the BUILT declarations, not the source.
//
// `src/matchers-entry.test.ts` guards the source and the wiring, but it cannot
// see the artifact, and tsup's dts rollup rewrites what it emits — it drops the
// bare `import type {} from "@jest/expect"` and `import "vitest"` side-effect
// imports, for instance. So a property that holds in `src/` can fail to hold in
// `dist/`, and `dist/` is the only thing a consumer ever reads.
//
// This lives in the e2e suite purely because `pretest:e2e` builds the package
// first, so `dist/` is guaranteed to exist and to be current. A unit test would
// have to either skip when `dist/` is missing (a guard that silently stops
// guarding) or fail on a clean checkout.
//
// No browser is involved; these are file assertions that happen to run under
// Playwright's runner.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

const dist = (name: string) =>
  readFileSync(
    fileURLToPath(new URL(`../dist/${name}`, import.meta.url)),
    "utf8",
  );

/**
 * A declaration file's CODE, with comments stripped.
 *
 * Emitted `.d.ts` carries the source JSDoc verbatim, and this package's JSDoc
 * legitimately names the augmentations it is describing — `dist/matchers.d.ts`
 * contains the phrase "a `namespace jest` merge does not reach" purely as
 * prose. Asserting on raw text fails on documentation that is doing its job.
 */
const code = (name: string) =>
  dist(name)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ");

/** Both module formats, for each types-only entry. */
const DECLARATIONS = [
  "matchers-jest.d.ts",
  "matchers-jest.d.cts",
  "matchers-vitest.d.ts",
  "matchers-vitest.d.cts",
  "matchers-jest-globals.d.ts",
  "matchers-jest-globals.d.cts",
];

test.describe("built matcher declarations", () => {
  for (const name of DECLARATIONS) {
    test(`${name} is a module, so its augmentation is legal`, () => {
      const text = dist(name);

      // `declare global` is only valid inside a MODULE. A declaration file with
      // no top-level import or export is a script, and TypeScript rejects the
      // block outright — TS2669, "Augmentations for the global scope can only
      // be directly nested in external modules". These entries have no exports
      // of their own and only type imports, so whether the rollup leaves an
      // import behind is the difference between a working entry and one that
      // breaks for every consumer.
      expect(text).toMatch(/^\s*(import|export)\b/m);
    });
  }

  test("each entry augments exactly its own runner", () => {
    // The whole point of splitting these: loading one must not drag in the
    // other runner's augmentation.
    const jest = code("matchers-jest.d.ts");
    expect(jest).toMatch(/declare global/);
    expect(jest).not.toMatch(/declare module ["']vitest["']/);

    const vitest = code("matchers-vitest.d.ts");
    expect(vitest).toMatch(/declare module ["']vitest["']/);
    expect(vitest).not.toMatch(/namespace jest/);

    const jestGlobals = code("matchers-jest-globals.d.ts");
    // `@jest/expect` re-exports `Matchers` from `expect`; the augmentation
    // merges through that alias. `@jest/globals` merely re-exports an `expect`
    // typed elsewhere, so augmenting IT would silently do nothing.
    expect(jestGlobals).toMatch(/declare module ["']@jest\/expect["']/);
    expect(jestGlobals).not.toMatch(/declare module ["']@jest\/globals["']/);
  });

  test("./matchers ships no augmentation of its own", () => {
    // The regression this package shipped: an unconditional jest global that a
    // Vitest consumer could not decline.
    const matchers = code("matchers.d.ts");
    expect(matchers).not.toMatch(/declare global/);
    expect(matchers).not.toMatch(/namespace jest/);
  });

  test("the vitest augmentation returns void, not the subject type", () => {
    // `A11yMatchers`' parameter is the matcher's RETURN type. Passing `T` (the
    // subject) made our declaration disagree with Vitest's own
    // `JestAssertion<T> extends jest.Matchers<void, T>`, which is what TS2320
    // reports as "not identical" — and it fires wherever both augmentations are
    // loaded, including this package's own `tsc` program.
    expect(code("matchers-vitest.d.ts")).toMatch(
      /interface Assertion<[^>]*>\s*extends\s+A11yMatchers<void>/,
    );
  });

  test("the types-only entries emit no runtime code", () => {
    for (const name of [
      "matchers-jest",
      "matchers-vitest",
      "matchers-jest-globals",
    ]) {
      for (const ext of ["js", "cjs"]) {
        const emitted = dist(`${name}.${ext}`)
          .replace(/\/\/[#@]\s*sourceMappingURL=.*$/gm, "")
          .replace(/["']use strict["'];?/g, "")
          .trim();
        expect(emitted, `${name}.${ext} should be empty`).toBe("");
      }
    }
  });
});
