// The version a change will first ship in, package-qualified.
//
// §4b is emphatic that a scenario's `Valid from` must name the package:
// "packages version independently, so a bare number is ambiguous". It is right,
// and it is also asking a human to know, at PR time, what `changeset version`
// will decide later. Changesets already knows — `changeset status` reports the
// next version for every package a pending changeset touches — so ask it.
//
// Failing softly is deliberate. This is one line of a report; if changesets
// can't run (no changesets pending, a partial checkout, whatever), the rest of
// the report is still worth printing.

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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
 * @returns {Promise<Map<string, {old: string, next: string}>>} package name →
 * the version it is on and the one its pending changesets will produce. Empty
 * when changesets can't answer.
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
    return new Map();
  }

  let dir;
  try {
    dir = await mkdtemp(join(tmpdir(), "surface-status-"));
    const out = join(dir, "status.json");
    // `changeset status` writes the file and exits 0 even with no releases.
    await run(process.execPath, [cli, "status", `--output=${out}`], {
      cwd: repoRoot,
    });
    const status = JSON.parse(await readFile(out, "utf8"));
    return new Map(
      (status.releases ?? []).map((r) => [
        r.name,
        { old: r.oldVersion, next: r.newVersion },
      ]),
    );
  } catch {
    return new Map();
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
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
 * When there's no pending changeset for the package, that is itself worth
 * saying: a user-visible change with no changeset won't ship, so the version
 * can't be stamped and the changeset is the missing piece.
 */
export function versionStamp(changePath, versions, removed = false) {
  const pkg = packageOf(changePath);
  if (!pkg) return null;
  const short = pkg.replace(/^@real-a11y-dev\//, "");
  const version = versions.get(pkg);
  if (!version) {
    return `no pending changeset for ${pkg} — the version this ships in isn't decided yet`;
  }
  return removed
    ? `Valid until: ${short} ≤ ${version.old}`
    : `Valid from: ${short} ≥ ${version.next}`;
}
