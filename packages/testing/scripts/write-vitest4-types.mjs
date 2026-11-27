// Writes `./matchers/vitest4` into `dist/` beside the compiled entries: the
// last step of `pnpm build`, after both tsup runs. `pnpm dev` runs it with
// `--watch`, beside `tsup --watch`, to rewrite it whenever `types/` changes.
//
// It is a hand-written declaration, not a tsup entry: it merges into Vitest
// 4's `Assertion<T = any>`, and this repo is on Vitest 5, so compiling it here
// fails with TS2428. `types/matchers-vitest4.d.ts` says more.
//
// In `pnpm build` it has to run after tsup rather than in its `onSuccess`
// hook. On a clean build, tsup's declaration build deletes every
// `*.d.{ts,mts,cts}` in `dist/` before it writes its own, and it runs
// alongside `onSuccess`, not before it, so a declaration written from the hook
// can be deleted.
//
// In `pnpm dev` it watches `types/` itself rather than through tsup. A bare
// `tsup --watch` skips changes to files no entry imports, and nothing imports
// this declaration. Naming `types` as a tsup watch path would fix that, but it
// also turns off what only the bare form does: re-reading `package.json` when
// it changes, so a dependency added mid-session stays external instead of
// being bundled. Watch mode doesn't clean, so what this writes survives tsup's
// rebuilds.
//
// It ships as the same four files a compiled types-only entry does: the
// declaration once per module format, each importing `A11yMatchers` from its
// own format's `matchers` file, and an empty module per format, so that a
// setup file importing it at run time resolves.

import { watch } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const pkg = new URL("../", import.meta.url);
const types = new URL("types/", pkg);
const dist = (name) => new URL(`dist/${name}`, pkg);

const ESM_SPECIFIER = `"./matchers.js"`;
const CJS_SPECIFIER = `"./matchers.cjs"`;

async function writeVitest4Types() {
  const source = await readFile(
    new URL("matchers-vitest4.d.ts", types),
    "utf8",
  );
  if (!source.includes(ESM_SPECIFIER)) {
    // The `.d.cts` is this file with its specifiers swapped. Fail the build
    // rather than ship a CJS declaration that reaches into the ESM types.
    throw new Error(
      `types/matchers-vitest4.d.ts no longer imports ${ESM_SPECIFIER}; update scripts/write-vitest4-types.mjs`,
    );
  }
  if (/from\s+["']\.\/(?!matchers\.js["'])/.test(source)) {
    // Any other relative import would keep its ESM specifier in the `.d.cts`.
    throw new Error(
      `types/matchers-vitest4.d.ts imports a relative module other than ${ESM_SPECIFIER}; teach scripts/write-vitest4-types.mjs its .cjs name`,
    );
  }

  await Promise.all([
    writeFile(dist("matchers-vitest4.d.ts"), source),
    writeFile(
      dist("matchers-vitest4.d.cts"),
      source.replaceAll(ESM_SPECIFIER, CJS_SPECIFIER),
    ),
    writeFile(dist("matchers-vitest4.js"), ""),
    writeFile(dist("matchers-vitest4.cjs"), `"use strict";\n`),
  ]);
}

if (!process.argv.includes("--watch")) {
  await writeVitest4Types();
} else {
  // `pnpm dev` starts this alongside tsup, so on a fresh checkout it can run
  // before tsup has created `dist/`.
  await mkdir(dist(""), { recursive: true });
  const rewrite = () =>
    writeVitest4Types().then(
      () => console.log("matchers-vitest4: wrote dist/matchers-vitest4.*"),
      // Report and keep watching: the next save may fix it.
      (error) => console.error(`matchers-vitest4: ${error.message}`),
    );
  await rewrite();
  // One directory, not recursive, so `fs.watch` behaves the same on every
  // platform. Editors save in bursts (truncate, write, rename), so settle
  // before rewriting.
  let pending;
  watch(types, () => {
    clearTimeout(pending);
    pending = setTimeout(rewrite, 100);
  });
  console.log("matchers-vitest4: watching types/");
}
