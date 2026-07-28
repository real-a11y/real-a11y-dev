// The two things `plan` needs from git: the base manifest, and what changed.
//
// Reading the base manifest out of git rather than rebuilding it is what keeps
// this cheap — no install, no build, no browser. The manifest is committed
// precisely so that `git show <base>:docs/surface.json` is a complete answer.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

async function git(repoRoot, args) {
  const { stdout } = await run("git", args, {
    cwd: repoRoot,
    maxBuffer: 32 * 1024 * 1024, // the manifest is ~68 KB; headroom for growth
  });
  return stdout;
}

/**
 * The merge base, so the diff shows what THIS branch did rather than everything
 * that has landed on main since it forked. `git diff a...b` uses it implicitly;
 * `git show` needs it named.
 */
export async function mergeBase(repoRoot, base) {
  try {
    return (await git(repoRoot, ["merge-base", base, "HEAD"])).trim();
  } catch {
    return base; // detached, shallow, or a base that isn't an ancestor
  }
}

/**
 * The manifest as of `ref`, or null when it didn't exist there — which is the
 * normal answer for a branch that forked before the manifest landed, and means
 * "everything is new" rather than "something is broken".
 */
export async function manifestAt(repoRoot, ref, path = "docs/surface.json") {
  try {
    return JSON.parse(await git(repoRoot, ["show", `${ref}:${path}`]));
  } catch {
    return null;
  }
}

/** Repo-relative POSIX paths this branch touched, for the "was it updated?" column. */
export async function changedFiles(repoRoot, base) {
  try {
    const out = await git(repoRoot, ["diff", "--name-only", `${base}...HEAD`]);
    return out.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}
