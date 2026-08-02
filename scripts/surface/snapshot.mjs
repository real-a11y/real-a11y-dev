// The released surface — what the newest publish actually shipped.
//
// `docs/surface.json` describes `main`. `docs/surface.released.json` describes
// the newest released version. Their difference is the set of capabilities the
// site documents but `npm install` does not yet deliver.
//
// That gap is otherwise invisible, and it is structural rather than accidental:
// docs.yml deploys the site on every push to `main`, npm publishes on a release
// cut, and nothing has ever compared the two. D8 asks a human to check exactly
// this at release time ("nothing documented is unshipped"), against no recorded
// answer — this is the recorded answer.
//
// WHY THIS COPIES RATHER THAN RE-EXTRACTS
//
// The committed manifest is the answer a human reviewed. Re-deriving it here
// would boot the MCP server a second time and could produce something subtly
// different from the diff that was approved, so the snapshot copies it byte for
// byte and can never disagree with it.
//
// That makes ORDERING load-bearing, and it is easy to get wrong. `changeset
// version` rewrites every `packages/*/package.json` version, and the manifest
// records those versions — so the instant it runs, `docs/surface.json` is stale
// and a copy of it would freeze the versions of the PREVIOUS release. The page
// would then name an older release than the one npm actually has, which is a
// more confusing lie than saying nothing.
//
// `version-packages` therefore runs `surface:extract` (and `surface:apply`,
// which keeps the managed regions consistent with the manifest it just
// rewrote) BEFORE this. Do not reorder them.
//
// WHY THIS RUNS IN THE RELEASE CUT, NOT IN publish.yml
//
// Three reasons, any one of them sufficient:
//
//   - The `branches` ruleset requires a pull request, so no workflow can push
//     this back to `main` at all.
//   - publish.yml is deliberately `contents: read` — least-privilege per
//     OpenSSF Scorecard's Token-Permissions check. Granting it write access to
//     commit a docs file would regress that posture for a file that has no
//     reason to be written by the job holding the npm token.
//   - The release PR is the artifact that declares what is shipping. The
//     snapshot belongs in its diff, where a reviewer sees the surface being
//     frozen next to the versions being bumped, and can object to both at once.
//
// So `version-packages` writes it, `changeset version` having just set the
// package versions the snapshot records.

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const RELEASED_REL = "docs/surface.released.json";
const MANIFEST_REL = "docs/surface.json";

/**
 * Freeze the current manifest as the released surface.
 *
 * @param {string} repoRoot
 * @returns {Promise<{written: boolean, packages: number}>}
 *   `written` is false when the snapshot already matched — a re-run of the
 *   release cut is not an error, and saying "wrote" when nothing changed would
 *   make an idempotent step look like a real one.
 */
export async function writeSnapshot(repoRoot) {
  let current;
  try {
    current = await readFile(join(repoRoot, MANIFEST_REL), "utf8");
  } catch {
    throw new SnapshotError([
      `${MANIFEST_REL} is missing — there is no surface to freeze.`,
      ``,
      `  pnpm surface:extract`,
    ]);
  }

  // Parse to validate, write the original bytes. A manifest that doesn't parse
  // must not become a snapshot that doesn't parse: the reader downstream would
  // then have to decide whether an unreadable released surface means "nothing
  // is released" or "everything is", and both answers are wrong.
  let parsed;
  try {
    parsed = JSON.parse(current);
  } catch (error) {
    throw new SnapshotError([
      `${MANIFEST_REL} isn't valid JSON, so it can't be frozen.`,
      ``,
      `  ${error.message}`,
      ``,
      `  pnpm surface:extract`,
    ]);
  }

  const path = join(repoRoot, RELEASED_REL);
  let previous = null;
  try {
    previous = await readFile(path, "utf8");
  } catch {
    // No snapshot yet — the first release writes one. Not an error: see the
    // note in the CONTRIBUTING section about why this file is deliberately not
    // seeded from `main`.
  }

  if (previous === current) {
    return { written: false, packages: parsed.packages?.length ?? 0 };
  }

  await writeFile(path, current, "utf8");
  return { written: true, packages: parsed.packages?.length ?? 0 };
}

/** Carries the same multi-line shape `die()` prints, so the verb can hand it straight over. */
export class SnapshotError extends Error {
  constructor(lines) {
    super(lines[0]);
    this.lines = lines;
  }
}
