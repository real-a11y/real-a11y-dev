// The version a change will first ship in, package-qualified.
//
// §4b is emphatic that a scenario's `Valid from` must name the package:
// "packages version independently, so a bare number is ambiguous". It is right,
// and it is also asking a human to know, at PR time, what `changeset version`
// will decide later. Changesets already knows — `changeset status` reports the
// next version for every package a pending changeset touches — so ask it.
//
// Failing softly is deliberate — this is one line of a report, and the rest of
// it is still worth printing. But softly is not silently: WHY the stamp is
// missing decides what the reader should do about it, so the failure modes are
// kept distinct rather than collapsed into one shrug.

import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Which package a change belongs to, by the manifest path it lives under. */
export function packageOf(changePath) {
  if (changePath.startsWith("cli.")) return "@real-a11y-dev/cli";
  if (changePath.startsWith("mcp.")) return "@real-a11y-dev/mcp";
  if (changePath.startsWith("packages.")) {
    return changePath.split(".")[1];
  }
  return null;
}

/**
 * @returns {Promise<{available: boolean, reason?: "none"|"unreadable", versions: Map<string, {old: string, next: string}>}>}
 * `available` is whether changesets answered; `reason` says why not when it
 * didn't; `versions` maps a package to the version it is on and the one its
 * pending changesets produce.
 */
export async function nextVersions(repoRoot) {
  // Resolve the installed CLI rather than shelling out to `npx`: with no
  // node_modules — which is the normal state in the CI job that posts this
  // report, since it deliberately skips the install — `npx` would silently
  // download changesets from the network to answer one line of a comment.
  let cli;
  try {
    cli = createRequire(join(repoRoot, "package.json")).resolve(
      "@changesets/cli/bin.js",
    );
  } catch {
    return unavailable("unreadable");
  }

  let dir;
  try {
    dir = await mkdtemp(join(tmpdir(), "surface-status-"));
    const out = join(dir, "status.json");
    // The absolute `--output` path is safe: changesets writes it via
    // `path.resolve(cwd, output)`, which an absolute second argument resets.
    // It does NOT always exit 0 — with packages changed and no changeset it
    // exits 1 and writes nothing, which the catch below has to interpret.
    await run(process.execPath, [cli, "status", `--output=${out}`], {
      cwd: repoRoot,
    });
    const status = JSON.parse(await readFile(out, "utf8"));
    return {
      available: true,
      versions: new Map(
        (status.releases ?? []).map((r) => [
          r.name,
          { old: r.oldVersion, next: r.newVersion },
        ]),
      ),
    };
  } catch {
    // Distinguish "you have no changesets" from "changesets is broken" — see
    // `changesetCount`. The first is the likelier cause and the only one the
    // reader can act on.
    return unavailable(
      (await changesetCount(repoRoot)) === 0 ? "none" : "unreadable",
    );
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Couldn't ask changesets — which is NOT the same fact as "changesets reports
 * no pending release for this package", though an empty map renders
 * identically. Saying the second when the first is true sends someone to write
 * a changeset that already exists.
 *
 * `reason` splits it further, because there are two ways to fail and they have
 * opposite remedies. `none` means the branch has no changeset files at all —
 * actionable, and the thing to say. `unreadable` means changesets is absent or
 * broke, which is the reader's problem, not their omission.
 */
function unavailable(reason) {
  return { available: false, reason, versions: new Map() };
}

/**
 * How many changesets the branch carries, counted from disk.
 *
 * Needed because `changeset status` **exits 1 and writes no file** when
 * packages changed with no changeset present — verified against the installed
 * `2.31.1`, which prints "Some packages have been changed but no changesets
 * were found." So a failed run cannot be read as "changesets is broken": the
 * commonest cause is the most actionable one, and this distinguishes them
 * without parsing changesets' English. Reading a directory also works with no
 * node_modules, which the CI job needs.
 */
async function changesetCount(repoRoot) {
  try {
    const files = await readdir(join(repoRoot, ".changeset"));
    return files.filter((f) => f.endsWith(".md") && f !== "README.md").length;
  } catch {
    return null; // no .changeset dir — not a changesets repo
  }
}

/**
 * The version stamp for a scenario covering `changePath`.
 *
 * Which side of the range depends on what happened. A new capability is
 * `Valid from` the version it first ships in. A REMOVED one is `Valid until`
 * the last version that still had it — which is the version the package is on
 * now, not the one it is about to become. §4b asks for exactly this and the two
 * are easy to transpose, so it is computed rather than typed.
 *
 * Four outcomes, not two, because each wants a different response: a stamp;
 * "this branch has no changeset at all" (add one); "changesets has nothing
 * pending for THIS package" (a user-visible change that won't ship); or "we
 * couldn't ask changesets" (fill it in by hand). Collapsing any of these into
 * another states a cause that hasn't been established.
 *
 * @param {{available: boolean, versions: Map}} status from {@link nextVersions}
 */
export function versionStamp(changePath, status, removed = false) {
  const pkg = packageOf(changePath);
  if (!pkg) return null;
  const short = pkg.replace(/^@real-a11y-dev\//, "");

  if (!status.available) {
    return status.reason === "none"
      ? `no changeset on this branch — add one (\`pnpm changeset\`) and this stamps itself`
      : `version not stamped — couldn't read pending changesets (\`pnpm changeset:status\`); fill this in by hand`;
  }

  const version = status.versions.get(pkg);
  if (!version) {
    return `no pending changeset for ${pkg} — the version this ships in isn't decided yet`;
  }
  return removed
    ? `Valid until: ${short} ≤ ${version.old}`
    : `Valid from: ${short} ≥ ${version.next}`;
}
