// Published packages name the React majors they support one major at a time —
// never an open-ended `>=`.
//
//   pnpm test:scripts                              all of them (and part of `pnpm verify`)
//   node --test scripts/react-peer-range.test.mjs  just this file
//
// WHY THIS IS A TEST AND NOT A CONVENTION. `"react": ">=18"` reads like
// generosity and behaves like a blank cheque: it accepts React 20, 21 and every
// major after them sight unseen, on packages that were never built against any
// of them. The day such a major lands, a consumer's install resolves silently
// clean and the breakage surfaces later — as a runtime fault or a type error
// that looks like our bug, with nothing at install time pointing at the real
// cause. An enumerated range fails the peer check instead: `ERESOLVE` on npm, a
// warning on pnpm and Yarn, either way naming the version that isn't supported.
//
// Every other peer this repo publishes already carries an upper bound
// (`playwright: ">=1.49.0 <2"`, `@jest/expect: ">=29 <31"`, storybook `^8.0.0`),
// and the internal `example-patterns` package already uses the exact range
// below. `react` / `react-dom` on the two published React packages were the
// outliers.
//
// WHAT THE RANGE MEANS, PRECISELY. It is the set of majors these packages
// support and document — NOT the set CI installs. Today both packages, and
// every React example, devDepend on React 19; no job installs React 18, so 18 is
// supported by source compatibility and by the docs rather than by a green leg.
// (It does hold: the `react` package typechecks clean against `@types/react@18`.)
// Adding that leg is worth doing and is not this file's business. What matters
// here is that neither the supported set nor the tested set may quietly grow a
// major nobody decided on.
//
// EXACT MATCH, not "parse the range and check for an upper bound". A range
// parser that mis-reads its input fails the same way the bug does: by quietly
// reporting that all is well. So the manifests are compared to one short
// constant, and the constant itself is checked to be a list of carets — a form
// with no open end, by construction, verifiable by looking at it.

import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * The React majors the published packages support.
 *
 * Widening this is a deliberate decision about a major that has not been built
 * against — make it here, in one place, and the manifests follow.
 */
const CANONICAL_RANGE = "^18.0.0 || ^19.0.0";

/** A single caret comparator, e.g. `^19.0.0`. Always bounded above. */
const CARET_COMPARATOR = /^\^\d+\.\d+\.\d+$/;

/** Peers that name React itself, as opposed to a React-adjacent library. */
const REACT_PEERS = ["react", "react-dom"];

const PACKAGES_DIR = fileURLToPath(new URL("../packages", import.meta.url));

/**
 * Every published package that declares a React peer, as
 * `{ dir, name, peers: { react?, "react-dom"? } }`.
 *
 * Private packages are skipped on purpose: nobody can install one, so an
 * over-wide range there cannot reach a consumer's resolver. The rule this file
 * enforces is about what npm hands to somebody else.
 */
async function publishedReactPackages() {
  const found = [];
  for (const entry of await readdir(PACKAGES_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = join(PACKAGES_DIR, entry.name, "package.json");
    let manifest;
    try {
      manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    if (manifest.private) continue;

    const peers = manifest.peerDependencies ?? {};
    const declared = REACT_PEERS.filter((peer) => peer in peers);
    if (declared.length === 0) continue;

    found.push({
      dir: entry.name,
      name: manifest.name,
      peers: Object.fromEntries(declared.map((peer) => [peer, peers[peer]])),
    });
  }
  return found;
}

describe("React peer ranges", () => {
  it("are declared by the packages we expect to declare them", async () => {
    const packages = await publishedReactPackages();

    // Every React package going private, or the peers being renamed away,
    // would leave the assertions below iterating an empty list and reporting
    // green. This file would then be checking nothing, silently — the exact
    // failure mode it was written to prevent.
    //
    // A rename of `packages/` is NOT that case and needs no guard: only the
    // per-manifest ENOENT is swallowed above, so `readdir` on a directory that
    // is not there rejects and fails this loudly.
    assert.ok(
      packages.length > 0,
      "no published package declares a react/react-dom peer — this test is " +
        "checking nothing; fix the discovery above rather than deleting it",
    );
  });

  it("enumerate majors rather than opening at one end", () => {
    // Without this, the whole guard could be undone by editing CANONICAL_RANGE
    // back to `>=18` alongside the manifests: everything would still agree, and
    // `pnpm verify` would still pass. A caret comparator cannot be open-ended,
    // so a range built only of carets joined by `||` has an upper bound by
    // construction — no parsing needed to see it.
    const comparators = CANONICAL_RANGE.split("||").map((part) => part.trim());

    for (const comparator of comparators) {
      assert.match(
        comparator,
        CARET_COMPARATOR,
        `CANONICAL_RANGE contains "${comparator}", which is not a caret ` +
          `comparator. Published React peers must name each supported major ` +
          `explicitly (e.g. "^18.0.0 || ^19.0.0") so that an unsupported major ` +
          `fails the peer check instead of resolving silently.`,
      );
    }
  });

  it("match that range in every published package", async () => {
    const packages = await publishedReactPackages();

    for (const { name, peers } of packages) {
      for (const [peer, range] of Object.entries(peers)) {
        assert.equal(
          range,
          CANONICAL_RANGE,
          `${name} declares "${peer}": "${range}". Published React peers must ` +
            `be exactly "${CANONICAL_RANGE}". To support a new major, widen ` +
            `CANONICAL_RANGE in this file — deliberately, once — and let the ` +
            `manifests follow it.`,
        );
      }
    }
  });
});
