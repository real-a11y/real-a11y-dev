// The PR template's carrier list must be the one the build configs imply.
//
//   pnpm test:scripts                         all of them (and part of `pnpm verify`)
//   node --test scripts/carriers.test.mjs     just this file
//
// A CARRIER is a published package, or the extension, whose build bundles an
// internal one. An internal package has no version of its own, so a change to it
// is released by naming its carriers in a changeset, and the PR template lists
// them so an author does not have to work that out.
//
// WHY THIS IS A TEST. That list is a hand-kept copy of the build graph, and it
// went stale the way hand-kept copies do: it said `core` ships inside
// `inspector`, `storybook-addon` and the extension long after `react`,
// `testing`, `cli` and `mcp` bundled it too, and it had no extension under
// `serialize`. Nothing failed. An author who trusted it would have released a
// core fix in two packages and left four shipping the old engine — the failure
// the list exists to prevent, and the one `inspector` once shipped for a whole
// release, bundling a `core` a version behind.
//
// DERIVED, NOT REPEATED. The expected text is built from the configs, so
// privatising a package, publishing a new one or changing what one bundles
// fails here until the template says so. Two sources:
//
//   - `noExternal` in each published package's `tsup.config.ts` — every array
//     in the file, since `storybook-addon` builds three entries with a list each;
//   - the extension's workspace dependencies, in either field, since Vite
//     bundles everything it imports and there is no `noExternal` to read.
//
// Then closed over the internal packages' own graph. What a bundled internal
// package inlines (its own `noExternal`) or imports (any workspace dependency)
// lands in the carrier too, listed there or not: tsup externalizes only the
// CARRIER's dependencies, so esbuild walks straight into the rest. That errs
// wide — an internal package's test-only dependency on another would add a
// carrier — which is the safe direction for a list that decides what gets
// released. A published dependency stays external and does not make a carrier:
// `react` depends on `inspector` and bundles `core` alone.
//
// EXACT MATCH, as in `pre-push-claims.test.mjs`: each claim is a literal string
// pinned on both sides after collapsing whitespace, so re-wrapping is free and
// an extra or missing package is not.

import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { describe, it } from "node:test";

/** Repo-root-relative, as a URL — a Windows path pasted into one is not a URL. */
const fromRepoRoot = (path) => new URL(`../${path}`, import.meta.url);

const SCOPE = "@real-a11y-dev/";
const TEMPLATE = ".github/PULL_REQUEST_TEMPLATE.md";

/** How the template names the one carrier that is not on npm. */
const EXTENSION = "the extension";

/**
 * Private packages that are applications or fixtures, not code a carrier
 * bundles. Named by directory; a new app under `packages/` belongs here.
 */
const APPS = new Set(["extension", "example-patterns"]);

/** `null` for a file that does not exist, so a package without one reads cleanly. */
async function readOptional(path) {
  try {
    return await readFile(fromRepoRoot(path), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

/** Workspace names in `deps`, unscoped. */
const workspaceNames = (deps) =>
  Object.keys(deps ?? {})
    .filter((name) => name.startsWith(SCOPE))
    .map((name) => name.slice(SCOPE.length));

/** A string literal, either quote. */
const STRING = /(["'])(?:(?!\1).)*\1/g;

/**
 * Every workspace name in every `noExternal: [...]` array of a tsup config.
 *
 * Read from source, so it refuses what it cannot read rather than skipping it:
 * an entry that is not a string literal — a RegExp, a spread, a variable —
 * would bundle packages this file never sees, so it throws instead. Line
 * comments are dropped first, so a commented-out list counts for nothing.
 */
function noExternalOf(source, file) {
  const code = source.replace(/^\s*\/\/.*$/gm, "");
  const names = new Set();
  for (const [, list] of code.matchAll(/noExternal:\s*\[([^\]]*)\]/g)) {
    const leftover = list
      .replace(STRING, "")
      .replace(/\/\/.*$/gm, "")
      .replace(/[\s,]/g, "");
    if (leftover !== "") {
      throw new Error(
        `${file}: a \`noExternal\` entry is not a string literal ` +
          `(${JSON.stringify(leftover)}), so what it bundles cannot be read ` +
          `here. Teach noExternalOf() the new shape.`,
      );
    }
    for (const [literal] of list.matchAll(STRING)) {
      const name = literal.slice(1, -1);
      if (name.startsWith(SCOPE)) names.add(name.slice(SCOPE.length));
    }
  }
  return [...names];
}

/** Every workspace package under `packages/`, keyed by unscoped name. */
async function workspace() {
  const entries = await readdir(fromRepoRoot("packages"), {
    withFileTypes: true,
  });
  const read = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async ({ name: dir }) => {
        const [manifest, tsup] = await Promise.all([
          readOptional(`packages/${dir}/package.json`),
          readOptional(`packages/${dir}/tsup.config.ts`),
        ]);
        if (manifest === null) return null;
        const pkg = JSON.parse(manifest);
        assert.ok(
          pkg.name?.startsWith(SCOPE),
          `packages/${dir} is named ${JSON.stringify(pkg.name)}, outside ${SCOPE}`,
        );
        return [
          pkg.name.slice(SCOPE.length),
          {
            dir,
            published: pkg.private !== true,
            dependencies: workspaceNames(pkg.dependencies),
            devDependencies: workspaceNames(pkg.devDependencies),
            noExternal:
              tsup === null
                ? null
                : noExternalOf(tsup, `packages/${dir}/tsup.config.ts`),
          },
        ];
      }),
  );
  return new Map(read.filter(Boolean));
}

/** Whether `name` is a private package a carrier can bundle. */
const isInternal = (packages, name) => {
  const pkg = packages.get(name);
  return pkg?.published === false && !APPS.has(pkg.dir);
};

/** Every internal package a build that names `roots` ends up inlining. */
function bundled(packages, roots) {
  const seen = new Set();
  const queue = [...roots];
  while (queue.length > 0) {
    const name = queue.pop();
    if (seen.has(name) || !isInternal(packages, name)) continue;
    seen.add(name);
    const pkg = packages.get(name);
    queue.push(
      ...pkg.dependencies,
      ...pkg.devDependencies,
      ...(pkg.noExternal ?? []),
    );
  }
  return seen;
}

/** internal package → the carriers that bundle it. */
function carrierMap(packages) {
  const builds = [];
  for (const [name, pkg] of packages) {
    if (pkg.published) builds.push([name, pkg.noExternal ?? []]);
    if (pkg.dir === "extension") {
      builds.push([EXTENSION, [...pkg.dependencies, ...pkg.devDependencies]]);
    }
  }

  const carriers = new Map();
  for (const [carrier, roots] of builds) {
    for (const internal of bundled(packages, roots)) {
      if (!carriers.has(internal)) carriers.set(internal, new Set());
      carriers.get(internal).add(carrier);
    }
  }
  return carriers;
}

const code = (name) => `\`${name}\``;

/**
 * Code-unit order, never `localeCompare`: the result is matched exactly, so it
 * must not depend on the collation of whichever machine runs the test.
 */
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Alphabetical, with the extension last — it is the one that takes no changeset. */
const byCarrier = (a, b) =>
  (a === EXTENSION) - (b === EXTENSION) || compare(a, b);

/**
 * The template's carrier line: internal packages that share a carrier set
 * share an entry, widest reach first.
 */
function carrierLine(carriers) {
  const groups = new Map();
  for (const [internal, set] of [...carriers].sort(([a], [b]) =>
    compare(a, b),
  )) {
    const ordered = [...set].sort(byCarrier);
    const key = ordered.join();
    if (!groups.has(key)) groups.set(key, { internals: [], carriers: ordered });
    groups.get(key).internals.push(internal);
  }
  return [...groups.values()]
    .sort(
      (a, b) =>
        b.carriers.length - a.carriers.length ||
        compare(a.internals[0], b.internals[0]),
    )
    .map(
      ({ internals, carriers: names }) =>
        `${internals.map(code).join(", ")} → ` +
        names.map((n) => (n === EXTENSION ? n : code(n))).join(", "),
    )
    .join(" · ");
}

/** Collapse every whitespace run to one space, so line wrapping is irrelevant. */
const normalize = (text) => text.replace(/\s+/g, " ");

const packages = await workspace();
const carriers = carrierMap(packages);
const internals = [...carriers.keys()].sort(compare);
const template = normalize(await readFile(fromRepoRoot(TEMPLATE), "utf8"));

describe("the PR template's carrier list", () => {
  it("reads what every published package bundles", () => {
    // Guards the guard. A published package whose `noExternal` the pattern
    // above no longer reads would drop out of every line below, and this file
    // would assert a shorter list than ships. An internal package a published
    // one depends on can only reach npm bundled, so each must turn up here.
    for (const [name, pkg] of packages) {
      if (!pkg.published) continue;
      const read = bundled(packages, pkg.noExternal ?? []);
      for (const dep of [...pkg.dependencies, ...pkg.devDependencies]) {
        if (!isInternal(packages, dep)) continue;
        assert.ok(
          read.has(dep),
          `${name} depends on the internal \`${dep}\`, but no \`noExternal\` ` +
            `naming it was read from packages/${pkg.dir}/tsup.config.ts. ` +
            `Either the config changed shape and noExternalOf() needs ` +
            `teaching, or ${name} holds \`${dep}\` without bundling it.`,
        );
      }
    }
    assert.ok(carriers.has("core"), "derived no carriers for `core` at all");
  });

  it("names every carrier of every internal package", () => {
    const line = carrierLine(carriers);
    assert.ok(
      template.includes(
        `drifts from them): ${line} - [ ] The internal packages`,
      ),
      `${TEMPLATE}'s carrier line no longer matches the build configs. ` +
        `It should read:\n\n      ${line}\n\n` +
        `An author releases a bundled-package change in the carriers listed ` +
        `there, so a missing one keeps shipping the old engine.`,
    );
  });

  it("lists every internal package as unpublished, and as one a PR can touch", () => {
    const claim = `The internal packages — ${internals.map(code).join(", ")} — are not published.`;
    assert.ok(template.includes(claim), `${TEMPLATE} should state: ${claim}`);
    for (const internal of internals) {
      const row = `- [ ] \`${SCOPE}${internal}\` (internal)`;
      assert.ok(
        template.includes(row),
        `${TEMPLATE}'s "Packages touched" has no row \`${row}\`.`,
      );
    }
  });
});
