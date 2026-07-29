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

/** Whether a ref resolves at all. */
export async function refExists(repoRoot, ref) {
  try {
    await git(repoRoot, [
      "rev-parse",
      "--verify",
      "--quiet",
      `${ref}^{commit}`,
    ]);
    return true;
  } catch {
    return false;
  }
}

/**
 * The merge base, so the diff shows what THIS branch did rather than everything
 * that has landed on main since it forked. `git diff a...b` uses it implicitly;
 * `git show` needs it named.
 *
 * Returns null rather than falling back to `base` when there isn't one. The
 * fallback looked harmless and wasn't: a base that doesn't resolve — a shallow
 * clone, or a CI checkout whose refspec never created `refs/remotes/origin/…` —
 * made every subsequent git call fail into its own catch, and the report came
 * out as a confident "the entire surface is new". Silence is the one failure
 * mode this tool can't afford, so the caller says so instead.
 */
export async function mergeBase(repoRoot, base) {
  try {
    return (await git(repoRoot, ["merge-base", base, "HEAD"])).trim();
  } catch {
    return null;
  }
}

/**
 * The manifest as of `ref`, or null when it didn't exist there — which is the
 * normal answer for a branch that forked before the manifest landed, and means
 * "everything is new" rather than "something is broken". The caller has already
 * established that `ref` resolves, so null here really is about the file.
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
