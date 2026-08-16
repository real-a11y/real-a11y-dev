// The matcher type augmentations are OPT-IN, one entry per runner. That is a
// type-level invariant, so nothing at runtime can observe it — and no `tsc` run
// in this repo can either, for two compounding reasons: the collision needs
// `skipLibCheck: false`, and it needs TypeScript 7, while this repo is on 5.x.
// The root tsconfig also compiles every entry into ONE program, so all three
// augmentations always coexist here and the opt-in-ness is structurally
// unobservable from inside.
//
// So these tests read the source and the wiring, which is the part that CAN be
// checked on every commit. They guard the two ways it actually breaks:
//
//   1. someone moves a `declare global` back into `./matchers` — how the
//      TS2320 collision shipped in the first place
//   2. the entries and the `exports` map drift apart in either direction: a
//      tsup entry with no subpath is unreachable, a subpath with no entry is a
//      404 that npm advertises. Both build perfectly cleanly
//
// The end-to-end proof — compiling as a consumer, on TypeScript 7, with
// `skipLibCheck: false`, in all three runner shapes — cannot live here. It is
// R36, and it is manual.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const src = (name: string) => read(`./${name}`);

/**
 * Source with comments stripped and whitespace collapsed.
 *
 * Comments in these files explain the history and legitimately NAME the
 * augmentations they describe, so matching raw text would assert on prose about
 * the code rather than the code. Trailing comments count: `// no declare global
 * here` at the end of a line is exactly the sort of note someone adds, and it
 * would fail a `not.toMatch(/declare global/)` on the text of its own reassurance.
 *
 * Collapsing whitespace matters too — Prettier owns the layout, and has already
 * rewrapped one of these declarations across four lines and moved an
 * `eslint-disable` into the middle of a type parameter list.
 *
 * This is not a parser: `//` inside a string literal would be stripped as a
 * comment. Nothing asserted here depends on string contents, and the
 * alternative is a TypeScript parse for a handful of greps.
 */
const stripComments = (text: string) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .replace(/\s+/g, " ");

const codeOf = (name: string) => stripComments(src(name));

// `tsup.config.ts` is read as TEXT, not imported: importing it pulls in
// `defineConfig` → esbuild, which throws on sight of jsdom's `TextEncoder`
// ("your JavaScript environment is broken"), and this suite runs under jsdom
// like the rest of the package.
//
// Comments are stripped BEFORE the quoted strings are collected. That file is
// densely commented — `noExternal` and `dts.resolve` carry paragraphs — and an
// apostrophe in a comment inside the array ("the adapter's own entry") would
// otherwise desynchronize the quote pairing and silently return garbage.
const entries: string[] = (() => {
  const config = stripComments(read("../tsup.config.ts"));
  const block = /entry:\s*\[([^\]]*)\]/.exec(config);
  if (!block) throw new Error("could not find `entry` in tsup.config.ts");
  return [...block[1].matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
})();

const exportsMap = JSON.parse(read("../package.json")).exports as Record<
  string,
  unknown
>;

/** Every matcher subpath, and the entry + emitted basename behind it. */
const MATCHER_ENTRIES = [
  ["./matchers", "src/matchers.ts", "matchers"],
  ["./matchers/vitest", "src/matchers-vitest.ts", "matchers-vitest"],
  ["./matchers/jest", "src/matchers-jest.ts", "matchers-jest"],
  [
    "./matchers/jest-globals",
    "src/matchers-jest-globals.ts",
    "matchers-jest-globals",
  ],
] as const;

describe("matcher type-augmentation entries", () => {
  it("keeps ./matchers free of every runner augmentation", () => {
    const code = codeOf("matchers.ts");
    expect(code).not.toMatch(/declare global/);
    expect(code).not.toMatch(/namespace jest/);
    expect(code).not.toMatch(/declare module ["']vitest["']/);
    expect(code).not.toMatch(/declare module ["']@jest\/expect["']/);
  });

  it("declares jest's global augmentation in ./matchers/jest only", () => {
    const code = codeOf("matchers-jest.ts");
    expect(code).toMatch(/declare global \{ namespace jest \{/);
  });

  it("declares vitest's augmentation in ./matchers/vitest only", () => {
    const code = codeOf("matchers-vitest.ts");
    expect(code).toMatch(/declare module ["']vitest["']/);
    expect(code).not.toMatch(/namespace jest/);
  });

  it("augments @jest/expect — not @jest/globals — in ./matchers/jest-globals", () => {
    const code = codeOf("matchers-jest-globals.ts");
    // `@jest/globals` re-exports an `expect` whose type comes from
    // `@jest/expect`; augmenting the re-export does nothing.
    expect(code).toMatch(/declare module ["']@jest\/expect["']/);
    expect(code).not.toMatch(/declare module ["']@jest\/globals["']/);
  });

  it.each(MATCHER_ENTRIES.filter(([subpath]) => subpath !== "./matchers"))(
    "keeps %s free of runtime code",
    (_subpath, entry) => {
      // These entries exist to be imported for their types alone, so every
      // import must be `import type`. A single value import would make the
      // built file emit, and pull the ~230 KB matchers chunk in behind it.
      const code = codeOf(entry.replace("src/", ""));
      const imports = [...code.matchAll(/(^|[;{} ])import\b[^;]*?from /g)];
      expect(imports.length).toBeGreaterThan(0);
      for (const [match] of imports) {
        expect(match).toMatch(/import type\b/);
      }
      // …and nothing exported, so there is no value surface at all.
      expect(code).not.toMatch(/\bexport (const|function|class|let|var) /);
    },
  );

  it("wires the same set of matcher entries into tsup and exports", () => {
    // Both directions. A tsup entry with no subpath is dead weight a consumer
    // cannot reach; a subpath with no entry is `ERR_MODULE_NOT_FOUND` on a
    // path the package advertises. Comparing SETS catches either, where a
    // per-row `toContain` catches only the first.
    const expected = MATCHER_ENTRIES.map(([, entry]) => entry);
    expect(entries.filter((e) => e.includes("matchers")).sort()).toEqual(
      [...expected].sort(),
    );
    expect(
      Object.keys(exportsMap)
        .filter((k) => k.startsWith("./matchers"))
        .sort(),
    ).toEqual(MATCHER_ENTRIES.map(([subpath]) => subpath).sort());
  });

  it.each(MATCHER_ENTRIES)(
    "ships %s at the expected paths",
    (subpath, _e, base) => {
      expect(exportsMap[subpath]).toEqual({
        types: {
          import: `./dist/${base}.d.ts`,
          require: `./dist/${base}.d.cts`,
        },
        import: `./dist/${base}.js`,
        require: `./dist/${base}.cjs`,
      });
    },
  );
});
