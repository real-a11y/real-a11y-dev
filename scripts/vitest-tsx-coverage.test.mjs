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
 * The string literals in one of `test`'s own array keys — `include` or
 * `exclude`.
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
 * Three outcomes, which the caller must keep apart:
 *
 *   `{ kind: "absent" }`      `test` declares no such key — vitest's default
 *                             applies, and the default `include` covers `.tsx`
 *                             while the default `exclude` (node_modules, dist,
 *                             build output) never matches a path under `src`.
 *   `{ kind: "patterns" }`    read successfully.
 *   `{ kind: "unreadable" }`  the key is there at `test`'s top level but its
 *                             array could not be read. Not the same as absent:
 *                             treating it as absent is how this check would go
 *                             quiet on the package it is meant to be watching.
 */
function readTestArray(configSource, keyName) {
  const opener = /\btest\s*:\s*\{/.exec(configSource);
  if (!opener) return { kind: "absent" };

  const firstChar = keyName[0];
  const keyPattern = new RegExp(`^${keyName}\\s*:`);

  // Depth counts both braces and brackets, so the key is only recognised at
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
      if (depth === 0) return { kind: "absent" }; // end of the `test` block
      continue;
    }
    if (depth !== 1 || char !== firstChar) continue;

    const prev = configSource[i - 1];
    if (prev !== undefined && /[\w$.]/.test(prev)) continue;
    const rest = configSource.slice(i);
    if (!keyPattern.test(rest)) continue;

    // The key is here. From this point every exit says "unreadable" rather
    // than "absent" — it exists, so failing to read it is a gap, not a default.
    const array = new RegExp(`^${keyName}\\s*:\\s*\\[`).exec(rest);
    if (!array) return { kind: "unreadable" };

    const body = readBracketed(configSource, i + array[0].length);
    if (body === null) return { kind: "unreadable" };
    return {
      kind: "patterns",
      patterns: [...body.matchAll(/["']([^"']*)["']/g)].map((m) => m[1]),
    };
  }
  return { kind: "absent" };
}

/**
 * Which of the sample `.tsx` paths vitest would NOT collect, given a package's
 * `test.include` and `test.exclude` as `readTestArray` returned them.
 *
 * Collection is include AND NOT exclude, so an exclusion can cancel a matching
 * include: `include: ["src/**\/*.test.{ts,tsx}"]` together with
 * `exclude: ["src/**\/*.test.tsx"]` collects no `.tsx` at all. Modelling only
 * the include side would call that config fine.
 *
 * An absent key means vitest's default, and both defaults are "no constraint"
 * for these paths: the default include covers `.tsx`, and the default exclude
 * (node_modules, dist, build output) matches nothing under `src`.
 */
function missedTsxSamples(include, exclude) {
  const included =
    include.kind === "patterns" ? include.patterns.map(globToRegExp) : null;
  const excluded =
    exclude.kind === "patterns" ? exclude.patterns.map(globToRegExp) : [];

  return SAMPLE_TSX_TESTS.filter((path) => {
    const matchesInclude =
      included === null || included.some((re) => re.test(path));
    return !matchesInclude || excluded.some((re) => re.test(path));
  });
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

describe("reading test.include / test.exclude", () => {
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
    assert.deepEqual(readTestArray(config, "include"), {
      kind: "patterns",
      patterns: ["src/**/*.test.ts"],
    });
    // And the nested `coverage.exclude` is not mistaken for `test.exclude`.
    assert.deepEqual(readTestArray(config, "exclude"), { kind: "absent" });
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
    assert.deepEqual(readTestArray(config, "include"), {
      kind: "patterns",
      patterns: ["src/**/*.test.{ts,tsx}"],
    });
  });

  it("reads test.exclude alongside test.include", () => {
    const config = `
      export default defineConfig({
        test: {
          include: ["src/**/*.test.{ts,tsx}"],
          exclude: ["src/**/*.test.tsx", "src/legacy/**"],
        },
      });
    `;
    assert.deepEqual(readTestArray(config, "exclude"), {
      kind: "patterns",
      patterns: ["src/**/*.test.tsx", "src/legacy/**"],
    });
  });

  it("calls a key absent — not unreadable — when only coverage declares it", () => {
    // The distinction matters: `coverage.include` does not replace vitest's
    // default test collection, which already covers `.tsx`. Reporting this as
    // a problem would fail `pnpm verify` for a perfectly good config.
    const config = `
      export default defineConfig({
        test: {
          environment: "jsdom",
          coverage: { include: ["src/**"] },
        },
      });
    `;
    assert.deepEqual(readTestArray(config, "include"), { kind: "absent" });
  });

  it("calls a present-but-unparseable key unreadable, not absent", () => {
    // Silently treating this as "no include, so vitest's default applies"
    // would be this check going quiet on the package it is watching.
    const config = `
      const shared = ["src/**/*.test.ts"];
      export default defineConfig({
        test: { include: shared },
      });
    `;
    assert.deepEqual(readTestArray(config, "include"), { kind: "unreadable" });
  });
});

describe("what vitest would collect", () => {
  const patterns = (...list) => ({ kind: "patterns", patterns: list });
  const absent = { kind: "absent" };

  it("accepts a {ts,tsx} include with no exclude", () => {
    assert.deepEqual(
      missedTsxSamples(patterns("src/**/*.test.{ts,tsx}"), absent),
      [],
    );
  });

  it("rejects a .ts-only include", () => {
    assert.deepEqual(
      missedTsxSamples(patterns("src/**/*.test.ts"), absent),
      SAMPLE_TSX_TESTS,
    );
  });

  it("rejects an exclude that cancels a matching include", () => {
    // The config looks right on the include side and collects no .tsx at all.
    assert.deepEqual(
      missedTsxSamples(
        patterns("src/**/*.test.{ts,tsx}"),
        patterns("src/**/*.test.tsx"),
      ),
      SAMPLE_TSX_TESTS,
    );
  });

  it("accepts an exclude that does not reach the .tsx suites", () => {
    assert.deepEqual(
      missedTsxSamples(
        patterns("src/**/*.test.{ts,tsx}"),
        patterns("src/legacy/**", "**/node_modules/**"),
      ),
      [],
    );
  });

  it("accepts an absent include as vitest's default, which covers .tsx", () => {
    assert.deepEqual(missedTsxSamples(absent, absent), []);
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

      const include = readTestArray(configSource, "include");
      const exclude = readTestArray(configSource, "exclude");

      // Unreadable is not absent. A key that is there but unparseable means
      // this check is no longer looking at the package it thinks it is — the
      // same silent gap it exists to prevent, so it is reported, never skipped.
      for (const [name, result] of [
        ["include", include],
        ["exclude", exclude],
      ]) {
        if (result.kind === "unreadable") {
          offenders.push(
            `${pkg.name}: has a vitest test.${name} but it could not be read — this check is not looking at it`,
          );
        }
      }
      if (include.kind === "unreadable" || exclude.kind === "unreadable") {
        continue;
      }

      checked += 1;
      const missed = missedTsxSamples(include, exclude);

      if (missed.length > 0) {
        const shown = [
          include.kind === "patterns"
            ? `include ${JSON.stringify(include.patterns)}`
            : "default include",
          ...(exclude.kind === "patterns"
            ? [`exclude ${JSON.stringify(exclude.patterns)}`]
            : []),
        ].join(" + ");
        offenders.push(
          `${pkg.name}: ${shown} would not collect ${missed.join(", ")}`,
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
