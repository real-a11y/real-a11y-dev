// Writes `./matchers/vitest4` into `dist/` beside the compiled entries. The
// last step of `pnpm build`, after both tsup runs.
//
// It is a hand-written declaration, not a tsup entry: it merges into Vitest
// 4's `Assertion<T = any>`, and this repo is on Vitest 5, so compiling it here
// fails with TS2428. `types/matchers-vitest4.d.ts` says more.
//
// It has to run after tsup rather than in its `onSuccess` hook. On a clean
// build, tsup's declaration build deletes every `*.d.{ts,mts,cts}` in `dist/`
// before it writes its own, and it runs alongside `onSuccess`, not before it,
// so a declaration written from the hook can be deleted.
//
// It ships as the same four files a compiled types-only entry does: the
// declaration once per module format, each importing `A11yMatchers` from its
// own format's `matchers` file, and an empty module per format, so that a
// setup file importing it at run time resolves.

import { readFile, writeFile } from "node:fs/promises";

const pkg = new URL("../", import.meta.url);
const dist = (name) => new URL(`dist/${name}`, pkg);

const ESM_SPECIFIER = `"./matchers.js"`;
const CJS_SPECIFIER = `"./matchers.cjs"`;

const source = await readFile(
  new URL("types/matchers-vitest4.d.ts", pkg),
  "utf8",
);
if (!source.includes(ESM_SPECIFIER)) {
  // The `.d.cts` is this file with one specifier swapped. Fail the build
  // rather than ship a CJS declaration that reaches into the ESM types.
  throw new Error(
    `types/matchers-vitest4.d.ts no longer imports ${ESM_SPECIFIER}; update scripts/write-vitest4-types.mjs`,
  );
}

await Promise.all([
  writeFile(dist("matchers-vitest4.d.ts"), source),
  writeFile(
    dist("matchers-vitest4.d.cts"),
    source.replace(ESM_SPECIFIER, CJS_SPECIFIER),
  ),
  writeFile(dist("matchers-vitest4.js"), ""),
  writeFile(dist("matchers-vitest4.cjs"), `"use strict";\n`),
]);
