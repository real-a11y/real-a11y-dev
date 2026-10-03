// Every `.test.tsx` file in the tree must actually be collected by the package
// that owns it.
//
//   pnpm test:scripts                                  all of them (and part of `pnpm verify`)
//   node --test scripts/vitest-tsx-coverage.test.mjs   just this file
//
// WHY THIS IS A TEST AND NOT A CONVENTION. A vitest `include` that misses a file
// extension fails SILENTLY: vitest collects the files it matches, reports them
// all green, and never mentions the suite it walked past. So a `Foo.test.tsx`
// added to a package whose `include` says `.test.ts` is not a red test — it is
// no test at all, and it stays that way until somebody reads the config. That
// is what happened to `packages/extension`. Every other failure mode in this
// repo announces itself; this one does not, which is why the invariant is
// asserted here instead of written down somewhere.
//
// WHY IT ASKS VITEST INSTEAD OF READING THE CONFIG. An earlier version of this
// file scanned `vitest.config.ts` as text to decide what the patterns would
// collect. Review found a fresh hole in that scanner three rounds running — an
// apostrophe in a comment, a `coverage.include` mistaken for `test.include`, a
// quoted key, `test.projects`, a config under a different filename — and every
// one of them failed the same way the bug does: by quietly reporting that all
// is well. A parser that can go quiet is the wrong instrument for catching
// something whose whole danger is going quiet.
//
// `vitest list --filesOnly` is the collection itself. It resolves the config
// the way the real run does, so there is no second implementation to keep
// correct and nothing left to model: comments, quoted keys, `projects`,
// `exclude`, extended configs and alternate filenames are all simply handled.
//
// The subjects are the `.test.tsx` files actually on disk rather than
// hypothetical paths, so this checks what is really there. A package with no
// `.tsx` suites is not examined — there is nothing that could be silently
// dropped. Today that means `extension`, `react`, `ui` and
// `examples/testing-vitest`.

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, relative, sep } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * Every workspace root that holds vitest suites CI runs. `examples/` counts:
 * `examples/testing-vitest` has its own config, its own 19 `.tsx` suites, and
 * its own CI step (`pnpm --filter @real-a11y-dev/example-testing test`), so a
 * narrowed `include` there would go just as quiet as it did in `extension`.
 */
const ROOTS = ["packages", "examples"].map((dir) =>
  fileURLToPath(new URL(`../${dir}`, import.meta.url)),
);

/** Every directory one level under a root, as [label, absolute path]. */
async function workspaceDirs() {
  const dirs = [];
  for (const root of ROOTS) {
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) dirs.push([entry.name, join(root, entry.name)]);
    }
  }
  return dirs;
}

/** Collection can be slow on a cold esbuild; generous, but not unbounded. */
const LIST_TIMEOUT_MS = 180_000;

async function findTestTsx(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    // A package with no `src` is simply not a subject. Anything else — EACCES,
    // a broken symlink, an interrupted install — would make this walk find no
    // suites and the check pass green on a package it could not actually read,
    // which is the silent pass this file exists to prevent.
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const found = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await findTestTsx(path)));
    else if (entry.name.endsWith(".test.tsx")) found.push(path);
  }
  return found;
}

/**
 * The test files vitest would collect in `packageDir`, as paths relative to it.
 *
 * Spawned as `node <vitest.mjs>` rather than through `node_modules/.bin`, which
 * is a shell script on POSIX and a `.CMD` on Windows — a Windows contributor
 * runs `pnpm verify` locally before pushing, so this runs there too.
 */
async function collectedTestFiles(packageDir) {
  const require = createRequire(join(packageDir, "/"));
  const vitestPkg = require.resolve("vitest/package.json");
  const cli = join(vitestPkg, "..", require(vitestPkg).bin.vitest);

  const { stdout } = await run(
    process.execPath,
    [cli, "list", "--filesOnly"],
    // CI=true keeps vitest non-interactive and unwatched.
    {
      cwd: packageDir,
      timeout: LIST_TIMEOUT_MS,
      env: { ...process.env, CI: "true" },
    },
  );

  return new Set(
    stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(line))
      // vitest prints POSIX separators; normalise so Windows compares equal.
      .map((line) => line.split("/").join(sep)),
  );
}

describe("vitest collects every .test.tsx file", () => {
  it("finds .tsx suites to check", async () => {
    // Guards the guard: if nothing is found, the case below passes vacuously
    // and this file would be watching nothing at all.
    let total = 0;
    for (const [, dir] of await workspaceDirs()) {
      total += (await findTestTsx(join(dir, "src"))).length;
    }
    assert.ok(total > 0, "no .test.tsx files found under any workspace src");
  });

  it("collects them in every package that has them", async (t) => {
    const missed = [];

    for (const [name, dir] of await workspaceDirs()) {
      const tsxTests = await findTestTsx(join(dir, "src"));
      if (tsxTests.length === 0) continue;

      let collected;
      try {
        collected = await collectedTestFiles(dir);
      } catch (error) {
        // Never swallowed into a pass: a package whose collection could not be
        // listed is a package this check is no longer watching.
        missed.push(
          `${name}: could not list collected files — ${error.message}`,
        );
        continue;
      }

      for (const test of tsxTests) {
        const rel = relative(dir, test);
        if (!collected.has(rel)) {
          missed.push(
            `${name}: ${rel.split(sep).join("/")} exists but vitest does not collect it`,
          );
        }
      }
      t.diagnostic(
        `${name}: ${tsxTests.length} .tsx suite(s), ${collected.size} file(s) collected`,
      );
    }

    assert.deepEqual(
      missed,
      [],
      `.tsx test files that exist but never run:\n  ${missed.join("\n  ")}`,
    );
  });
});
