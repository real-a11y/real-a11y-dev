// A package that has `.tsx` sources must have a vitest `include` that collects
// `.tsx` test files.
//
//   pnpm test:scripts                                  all of them (and part of `pnpm verify`)
//   node --test scripts/vitest-tsx-coverage.test.mjs   just this file
//
// WHY THIS IS A TEST AND NOT A CONVENTION. An `include` that misses a file
// extension fails SILENTLY: vitest collects the files it matches, reports them
// all green, and never mentions the suite it walked past. So a `Foo.test.tsx`
// added to a package whose `include` says `.test.ts` is not a red test — it is
// no test at all, and it stays that way until somebody reads the config. Every
// other failure mode in this repo announces itself; this one does not, which is
// why the invariant is asserted here instead of written down somewhere.
//
// The invariant is one-directional on purpose. A package with `.tsx` sources
// has to be able to hold `.tsx` tests. A package with none may include `.tsx`
// anyway (`inspector` does) and that is not a defect.
//
// Node's own test runner, and node core only — same constraint as
// `pr-risk.test.mjs`, so this file stays runnable without `pnpm install`.

import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const PACKAGES = fileURLToPath(new URL("../packages", import.meta.url));

/** Paths a `.tsx` suite would realistically be written at. */
const SAMPLE_TSX_TESTS = ["src/Widget.test.tsx", "src/panel/Widget.test.tsx"];

function escapeLiteral(char) {
  return /[.*+?^${}()|[\]\\]/.test(char) ? `\\${char}` : char;
}

/**
 * The slice of glob syntax these configs actually use: `**`, `*` and `{a,b}`.
 * Deliberately not a general matcher — it only has to answer "would this
 * pattern collect that path", and a wrong answer here shows up as a failing
 * case below rather than as a silently permissive check.
 */
function globToSource(glob) {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i];
    if (char === "*") {
      if (glob[i + 1] === "*") {
        if (glob[i + 2] === "/") {
          // `**/` spans any number of directories, including none.
          out += "(?:[^/]+/)*";
          i += 2;
        } else {
          out += ".*";
          i += 1;
        }
      } else {
        out += "[^/]*";
      }
      continue;
    }
    if (char === "{") {
      const end = glob.indexOf("}", i);
      if (end !== -1) {
        // Alternatives go back through the same conversion, so a wildcard
        // inside a brace group (`{*.test.ts,*.test.tsx}`) stays a wildcard
        // instead of being escaped into a literal `*`.
        const alternatives = glob
          .slice(i + 1, end)
          .split(",")
          .map(globToSource);
        out += `(?:${alternatives.join("|")})`;
        i = end;
        continue;
      }
    }
    out += escapeLiteral(char);
  }
  return out;
}

function globToRegExp(glob) {
  return new RegExp(`^${globToSource(glob)}$`);
}

/**
 * The string literals in the config's `test.include`.
 *
 * Scanned rather than regexed, for two reasons that both bite in this repo's
 * own configs:
 *
 *   - `coverage.include` is spelled the same as `test.include`. Taking the
 *     first `include:` in the file could point this whole check at patterns
 *     that say nothing about which test files get collected — and a
 *     `coverage.include` of `["src/**"]` would make it pass vacuously, which
 *     is the one failure mode this file must not have.
 *   - `{` and `}` occur inside the patterns themselves (`*.test.{ts,tsx}`), so
 *     brace counting has to skip over quoted strings or it ends the block
 *     mid-pattern.
 *
 * Returns null when `test` declares no `include` of its own — vitest's default
 * then applies, and that already covers `.tsx`.
 */
function readIncludePatterns(configSource) {
  const opener = /\btest\s*:\s*\{/.exec(configSource);
  if (!opener) return null;

  // Depth counts both braces and brackets, so `include` is only recognised at
  // the `test` block's own top level (depth 1) and never inside `coverage`.
  let depth = 1;
  let quote = null;

  for (let i = opener.index + opener[0].length; i < configSource.length; i++) {
    const char = configSource[i];

    if (quote !== null) {
      if (char === "\\") i += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{" || char === "[") {
      depth += 1;
      continue;
    }
    if (char === "}" || char === "]") {
      depth -= 1;
      if (depth === 0) return null; // end of the `test` block
      continue;
    }
    if (depth !== 1 || char !== "i") continue;

    const prev = configSource[i - 1];
    if (prev !== undefined && /[\w$.]/.test(prev)) continue;
    const key = /^include\s*:\s*\[/.exec(configSource.slice(i));
    if (!key) continue;

    const array = readBracketed(configSource, i + key[0].length);
    if (array === null) return null;
    return [...array.matchAll(/["']([^"']*)["']/g)].map((m) => m[1]);
  }
  return null;
}

/** Text between an already-consumed `[` at `start` and its matching `]`. */
function readBracketed(source, start) {
  let depth = 1;
  let quote = null;
  for (let i = start; i < source.length; i++) {
    const char = source[i];
    if (quote !== null) {
      if (char === "\\") i += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") quote = char;
    else if (char === "[") depth += 1;
    else if (char === "]") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i);
    }
  }
  return null;
}

async function hasTsxSource(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (await hasTsxSource(join(dir, entry.name))) return true;
    } else if (entry.name.endsWith(".tsx")) {
      return true;
    }
  }
  return false;
}

describe("glob matching", () => {
  it("does not let a .ts-only pattern match a .tsx path", () => {
    // The whole check rests on this: a permissive matcher would pass every
    // package vacuously and guard nothing.
    const tsOnly = globToRegExp("src/**/*.test.ts");
    for (const path of SAMPLE_TSX_TESTS) {
      assert.equal(tsOnly.test(path), false, `${path} must not match`);
    }
    assert.equal(tsOnly.test("src/panel/Widget.test.ts"), true);
  });

  it("matches .tsx paths at any depth under a {ts,tsx} pattern", () => {
    const both = globToRegExp("src/**/*.test.{ts,tsx}");
    for (const path of [...SAMPLE_TSX_TESTS, "src/panel/Widget.test.ts"]) {
      assert.equal(both.test(path), true, `${path} must match`);
    }
    assert.equal(both.test("src/Widget.tsx"), false);
  });

  it("keeps wildcards inside a brace group working", () => {
    // Escaping the `*` here would report a perfectly good pattern as an
    // offender and break `pnpm verify` for whoever wrote it.
    const grouped = globToRegExp("src/**/{*.test.ts,*.test.tsx}");
    for (const path of [...SAMPLE_TSX_TESTS, "src/panel/Widget.test.ts"]) {
      assert.equal(grouped.test(path), true, `${path} must match`);
    }
    assert.equal(grouped.test("src/Widget.tsx"), false);
  });
});

describe("reading test.include", () => {
  it("reads test.include, not a coverage.include that precedes it", () => {
    // `coverage.include` is spelled the same. Taking the first `include:` in
    // the file would point the check at patterns that say nothing about which
    // test files get collected — and `["src/**"]` would make it pass
    // vacuously, which is the one failure this file must not have.
    const config = `
      export default defineConfig({
        test: {
          environment: "jsdom",
          coverage: { include: ["src/**"], exclude: ["src/**/*.d.ts"] },
          include: ["src/**/*.test.ts"],
        },
      });
    `;
    assert.deepEqual(readIncludePatterns(config), ["src/**/*.test.ts"]);
  });

  it("reads test.include when it comes first", () => {
    const config = `
      export default defineConfig({
        test: {
          include: ["src/**/*.test.{ts,tsx}"],
          coverage: { include: ["src/**"] },
        },
        esbuild: { jsx: "automatic" },
      });
    `;
    assert.deepEqual(readIncludePatterns(config), ["src/**/*.test.{ts,tsx}"]);
  });

  it("reports no explicit include rather than borrowing another block's", () => {
    const config = `
      export default defineConfig({
        test: {
          environment: "jsdom",
          coverage: { include: ["src/**"] },
        },
      });
    `;
    assert.equal(readIncludePatterns(config), null);
  });
});

describe("vitest include patterns", () => {
  it("collects .tsx tests in every package that has .tsx sources", async () => {
    const packages = await readdir(PACKAGES, { withFileTypes: true });
    const offenders = [];
    let checked = 0;

    for (const pkg of packages) {
      if (!pkg.isDirectory()) continue;
      const dir = join(PACKAGES, pkg.name);

      let configSource;
      try {
        configSource = await readFile(join(dir, "vitest.config.ts"), "utf8");
      } catch {
        // No vitest config: nothing collects tests here at all, which is a
        // different question from which extensions get collected.
        continue;
      }

      if (!(await hasTsxSource(join(dir, "src")))) continue;

      const patterns = readIncludePatterns(configSource);
      if (patterns === null) {
        // No explicit `include` means vitest's default, which already covers
        // `.tsx`. But a config that plainly HAS one and still reads as null is
        // a broken parser above, not a permissive config — and silently
        // skipping it is the failure this file exists to prevent, so say so.
        if (/\binclude\s*:/.test(configSource)) {
          offenders.push(
            `${pkg.name}: has a vitest include but it could not be read — this check is not looking at it`,
          );
        }
        continue;
      }

      checked += 1;
      const matchers = patterns.map(globToRegExp);
      const missed = SAMPLE_TSX_TESTS.filter(
        (path) => !matchers.some((re) => re.test(path)),
      );
      if (missed.length > 0) {
        offenders.push(
          `${pkg.name}: include ${JSON.stringify(patterns)} would not collect ${missed.join(", ")}`,
        );
      }
    }

    assert.ok(checked > 0, "found no packages with .tsx sources to check");
    assert.deepEqual(
      offenders,
      [],
      `packages with .tsx sources whose vitest include skips .tsx tests:\n  ${offenders.join("\n  ")}`,
    );
  });
});
