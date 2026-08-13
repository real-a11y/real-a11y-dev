// What a pull request here is risking — computed from its diff, not judged.
//
//   node scripts/pr-risk.mjs                        the tier + why, as text
//   node scripts/pr-risk.mjs --format markdown      the PR comment body
//   node scripts/pr-risk.mjs --format json          for a workflow to read
//   node scripts/pr-risk.mjs --gate --reviewed      exit 1 if high risk is unreviewed
//
// Three tiers, and the tier decides two things: how deep the review goes
// (`.claude/skills/pr/SKILL.md` §3a) and whether an agent may merge the PR
// itself instead of leaving it for a human (§9b).
//
// IN CI THIS RUNS FROM THE BASE BRANCH, not from the pull request — see the
// header of `.github/workflows/pr-risk.yml`. A rubric a PR can edit is a rubric
// that PR can switch off, and `--repo` exists for exactly that separation.
//
// It fails CLOSED. Anything it needs and cannot read is an error, never an empty
// answer: an empty diff matches no rule, grades low, and exits 0.
//
// It is a rubric rather than a score on purpose. A number invites tuning until
// the thing you wanted to catch falls under the threshold; a named reason —
// "this touches .github/workflows, which holds NPM_TOKEN" — either applies or
// doesn't, and a reviewer can argue with it. Every rule below cites the concrete
// damage it is guarding against, and a rule nobody can justify that way should
// be deleted rather than down-weighted.
//
// **It classifies blast radius, not correctness.** A one-character typo in
// `publish.yml` is high; a 2,000-line docs rewrite is low. Nothing here reads
// the diff for whether the change is any *good* — that is the review's job, and
// the tier only decides how much review to spend.
//
// Node core and `git` only, no `node_modules` — same constraint as
// `surface plan`, for the same reason: the CI job that runs this skips the
// install, and a top-level import of anything installed would make it fail with
// ERR_MODULE_NOT_FOUND on precisely the run that matters.

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * The repository being graded — NOT necessarily where this file lives.
 *
 * The CI gate deliberately runs the BASE branch's copy of this script out of
 * `$RUNNER_TEMP`, because a rubric checked out from the pull request is a rubric
 * the pull request can rewrite. Deriving the root from `import.meta.url` would
 * then resolve to the temp directory and every git call would run against the
 * wrong tree — so the root is an argument, and only falls back to this file's
 * own location for the ordinary `pnpm pr:risk` case.
 */
let repoRoot = resolve(fileURLToPath(import.meta.url), "../..");

/** Bare enough to be obvious in CI logs; the detail is in the failure body. */
function die(lines) {
  console.error(`\n${lines.join("\n")}\n`);
  process.exit(1);
}

async function git(args) {
  const { stdout } = await run("git", args, {
    cwd: repoRoot,
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout;
}

/**
 * Run git, and DIE if it fails. This is the default for anything whose absence
 * would change the verdict.
 *
 * The version this replaced returned a benign fallback everywhere, which made
 * the required gate fail **open**: a `git diff` that errored for any reason
 * produced an empty file list, an empty file list matches no rule, no rule means
 * 🟢 low, and low exits 0 — silently, with the report cheerfully stating "0
 * files changed". A control that reports "nothing to see here" when it cannot
 * see is worse than no control, because the green check is evidence to whoever
 * reads it.
 *
 * `gitOr` still exists below for the two reads where an empty answer is a real,
 * expected answer rather than a failure.
 */
async function gitOrDie(args, what) {
  try {
    return await git(args);
  } catch (error) {
    die([
      `Can't read ${what} from git — refusing to grade this diff.`,
      ``,
      `  git ${args.join(" ")}`,
      `  ${error.shortMessage ?? error.message}`,
      ``,
      `  This exits non-zero on purpose. The alternative is reporting an empty`,
      `  diff, which is indistinguishable from a clean PR and would pass the gate.`,
    ]);
  }
}

/**
 * Run git, tolerate failure.
 *
 * Only for reads where "it didn't work" and "there is nothing there" are the
 * same answer and neither can hide a risk — `git show <base>:<path>` for a file
 * that legitimately did not exist at the base, which means "new", not "broken".
 */
async function gitOr(args, fallback) {
  try {
    return await git(args);
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Facts
// ---------------------------------------------------------------------------

/**
 * Path-safe `git diff`.
 *
 * Three git defaults each quietly defeat every `^`-anchored rule in the rubric,
 * and all three are ordinary things to hit rather than exotic ones:
 *
 * - **rename detection** (on by default since 2.9) reports only a renamed file's
 *   NEW path, so `git mv .github/workflows/publish.yml docs/publish.yml` grades
 *   🟢 low while the identical change as `rm` + add grades 🔴 high;
 * - **core.quotePath** wraps any non-ASCII path in literal double quotes, so the
 *   leading `"` breaks the anchor — `packages/core/src/José.ts` grades low where
 *   `Jose.ts` grades medium;
 * - **newline-separated output** is ambiguous for paths containing newlines.
 *
 * `-z` + `core.quotePath=false` + `--no-renames` closes all three, which is why
 * they travel together here instead of being applied per call site.
 */
function diffArgs(extra) {
  return ["-c", "core.quotePath=false", "diff", "--no-renames", "-z", ...extra];
}

/** NUL-separated git output → array. */
const splitZ = (out) => out.split("\0").filter(Boolean);

/** This file's own path in the repo — see the `excludeSelf` rule flag. */
const SELF_PATH = "scripts/pr-risk.mjs";

/**
 * Everything the rules are allowed to look at, gathered once.
 *
 * Deliberately a flat bag of already-answered questions rather than a handle a
 * rule can run more git against: a rule that shells out is a rule whose cost
 * depends on how many other rules ran first, and the ordering then matters for
 * reasons that have nothing to do with risk.
 */
async function collectFacts(base) {
  if (
    !(await gitOr(["rev-parse", "--verify", "--quiet", `${base}^{commit}`]))
  ) {
    die([
      `Can't resolve \`${base}\`.`,
      ``,
      `  In CI this usually means the checkout's refspec never created the`,
      `  remote-tracking ref. Fetch it explicitly:`,
      ``,
      `    git fetch --no-tags origin +refs/heads/<branch>:refs/remotes/origin/<branch>`,
      ``,
      `  Locally: git fetch origin, or pass --base <ref>.`,
    ]);
  }

  // The merge base, so the answer is what THIS branch did rather than
  // everything that has landed on main since it forked. Without it, a branch
  // that is merely behind reads as high risk because main's own release commits
  // show up in its diff — the exact PRs this is supposed to wave through.
  const mergeBase = (await gitOr(["merge-base", base, "HEAD"], "")).trim();
  if (!mergeBase) {
    die([
      `\`${base}\` and HEAD have no common ancestor.`,
      ``,
      `  A shallow clone is the usual cause — this needs enough history to find`,
      `  the merge base (actions/checkout with fetch-depth: 0).`,
    ]);
  }

  // Two-dot against the merge base — i.e. compared to the WORKING TREE, not to
  // HEAD. In CI those are the same thing, so the answer there is unchanged; the
  // difference is local, where the author runs this before committing and a
  // HEAD-only diff would report an empty PR. Untracked files are added
  // separately because `git diff` cannot see them, and a brand-new workflow file
  // is exactly the kind of thing this must not miss on its first run.
  //
  // The manifest rules below read the working tree too. Mixing the two scopes is
  // what this replaced: `files` came from HEAD while `rootPackageKeys` came from
  // disk, so an uncommitted change reported "0 files changed" and a high tier in
  // the same breath.
  const tracked = splitZ(
    await gitOrDie(
      diffArgs(["--name-only", mergeBase]),
      "the list of changed files",
    ),
  );
  const untracked = splitZ(
    await gitOrDie(
      [
        "-c",
        "core.quotePath=false",
        "ls-files",
        "--others",
        "-z",
        "--exclude-standard",
      ],
      "the list of untracked files",
    ),
  );
  const files = [...new Set([...tracked, ...untracked])];

  // `--numstat` cannot see untracked files, so counting only it made the header
  // contradict itself — a new uncommitted 800-line workflow reported
  // "1 files, 0 lines". The tier was right and the number was a lie, which is
  // exactly what the commit "stop the risk report counting its own output"
  // exists to prevent. So untracked files are counted by reading them.
  const numstat = splitZ(
    await gitOrDie(diffArgs(["--numstat", mergeBase]), "the diff line counts"),
  );
  let lines = numstat.reduce((n, row) => {
    const [added, removed] = row.split("\t");
    // Binary files report `-`; they contribute files but not lines.
    return n + (Number(added) || 0) + (Number(removed) || 0);
  }, 0);
  for (const file of untracked) {
    try {
      const text = await readFile(resolve(repoRoot, file), "utf8");
      lines += text.length ? text.split("\n").length : 0;
    } catch {
      // Unreadable or binary — it still counts as a file, just not as lines.
    }
  }

  // Only the file types that can carry a secret or a redaction boundary. Scoped
  // this narrowly because the alternative — the whole diff — is unbounded on a
  // PR that regenerates a snapshot fixture, and the rule reading it cares about
  // code, not data.
  //
  // BOTH sides, not just additions. Scanning `+` lines alone meant that
  // *removing* a `redactUrl()` call — the single most direct way to reintroduce
  // the leak the rule exists for — graded LOWER than adding one. `-U0` keeps
  // this bounded to changed lines.
  const codeDiff = await gitOrDie(
    [
      "-c",
      "core.quotePath=false",
      "diff",
      "--no-renames",
      "-U0",
      mergeBase,
      "--",
      "*.ts",
      "*.tsx",
      "*.mjs",
      "*.js",
      "*.yml",
      "*.yaml",
    ],
    "the code diff",
  );
  const changedLines = (section) =>
    section
      .split("\n")
      .filter(
        (l) =>
          (l.startsWith("+") || l.startsWith("-")) &&
          !l.startsWith("+++") &&
          !l.startsWith("---"),
      )
      .join("\n");

  // Kept per-file so a rule can opt out of scanning the rubric's own source
  // (see `excludeSelf`). Splitting on the `diff --git` header is safe here
  // because `core.quotePath=false` and `--no-renames` mean the paths are literal
  // and the two sides always match.
  const sections = codeDiff.split(/^diff --git /m).filter(Boolean);
  const codeByFile = new Map();
  for (const section of sections) {
    const path = section.match(/^a\/(.*?) b\//)?.[1];
    if (path) codeByFile.set(path, changedLines(section));
  }
  const joinExcept = (skip) =>
    [...codeByFile]
      .filter(([path]) => path !== skip)
      .map(([, body]) => body)
      .join("\n");

  return {
    base,
    mergeBase,
    files,
    lines,
    touchedCode: joinExcept(null),
    touchedCodeExcludingSelf: joinExcept(SELF_PATH),
    changesets: await readChangesets(files),
    rootPackageKeys: await changedRootPackageKeys(mergeBase),
    packageManifests: await changedPackageManifests(mergeBase, files),
    surfaceRemovals: await surfaceRemovals(mergeBase, files),
  };
}

/**
 * The bump levels this branch's pending changesets declare.
 *
 * Read straight off disk rather than through `@changesets/read`, to hold the
 * no-`node_modules` line. The format that matters here is two `---` fences
 * around `"pkg": bump` lines, which is stable and trivially parsed; anything
 * more exotic is a changeset this rule declines to have an opinion about rather
 * than one it guesses at.
 */
async function readChangesets(files) {
  // THIS BRANCH's changesets — intersected with the diff, not read off disk.
  //
  // Reading the whole directory meant one pending `major` anywhere in
  // `.changeset/` marked EVERY pull request in the repo 🔴 high, citing a file
  // the PR never touched. Latent only because the repo currently holds 132
  // pending entries at 0 major; the first `major` to land would have failed a
  // required check on every docs typo for the rest of the beta, leaving
  // `risk-override` as the only way through — and an override applied to
  // everything stops meaning anything on the PR where it matters.
  //
  // Every neighbouring fact was already scoped this way, and the docstring
  // above already claimed it. It is also ~400 fewer reads per workflow event.
  const entries = files.filter(
    (f) => /^\.changeset\/[^/]+\.md$/.test(f) && !/\/readme\.md$/i.test(f),
  );

  const out = [];
  for (const path of entries) {
    const name = path.slice(".changeset/".length);
    let text;
    try {
      text = await readFile(resolve(repoRoot, path), "utf8");
    } catch {
      // Deleted by this branch — nothing left to declare.
      continue;
    }
    const fence = text.split(/^---\s*$/m);
    if (fence.length < 3) continue;
    for (const line of fence[1].split("\n")) {
      const m = line.match(
        /^\s*["']?(@?[^"':]+)["']?\s*:\s*(major|minor|patch)/,
      );
      if (m) out.push({ file: name, package: m[1].trim(), bump: m[2] });
    }
  }
  return out;
}

/**
 * Which top-level keys of the ROOT package.json this branch changed.
 *
 * The root manifest is edited constantly — a new script, a bumped devDependency
 * — and treating every touch as high risk would put most chores in the tier
 * that can never auto-merge, which is how a rubric stops being read. So the
 * rule below asks which keys moved, and only the ones that change what gets
 * built, published, or run count.
 */
async function changedRootPackageKeys(mergeBase) {
  const before = await gitOr(["show", `${mergeBase}:package.json`], null);
  if (before === null) return [];
  let a, b;
  try {
    a = JSON.parse(before);
    b = JSON.parse(await readFile(resolve(repoRoot, "package.json"), "utf8"));
  } catch {
    // Unparseable on either side is itself worth a human — say so by naming the
    // whole file rather than silently reporting "nothing changed".
    return ["<unparseable>"];
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
}

/**
 * Publish-shaping keys — what a consumer can observe after `npm install`.
 *
 * `scripts` is here because a published package's `postinstall` runs arbitrary
 * code on **every consumer's machine at install time**. The root manifest's
 * `scripts` was already graded high for defining what `pnpm verify` runs in this
 * repo; a package's is strictly the larger radius and was graded by nothing —
 * adding a `postinstall` to `packages/cli` came out 🟢 low, "an agent may merge
 * it".
 *
 * `dependencies` and `peerDependencies` are deliberately NOT here. They made
 * every weekly grouped Dependabot PR 🔴 high — ten `packages/<pkg>/package.json` at
 * a time, three of them `private` and never published — from a bot author that
 * cannot label itself, so the repo's most frequent PR stalled every week on a
 * hand-applied `reviewed:deep`. That is the habituation this file's header warns
 * about. A dependency change still reaches 🟡 medium through the `dependencies`
 * rule on `pnpm-lock.yaml`, which is where a version change becomes real, and
 * that now matches what SKILL.md's medium row has always said.
 */
const PACKAGING_KEYS = [
  "name",
  "version",
  "private",
  "main",
  "module",
  "types",
  "typesVersions",
  "exports",
  "files",
  "bin",
  "scripts",
  "publishConfig",
  "engines",
  "sideEffects",
];

/**
 * Per-package manifests whose PUBLISHING shape moved.
 *
 * Same idea as the root, different key set: a devDependency bump inside
 * `packages/cli` changes nothing a consumer can observe, while `exports` or
 * `files` decides whether an import resolves at all for everyone who installs it.
 */
async function changedPackageManifests(mergeBase, files) {
  const touched = files.filter((f) =>
    /^packages\/[^/]+\/package\.json$/.test(f),
  );
  const out = [];
  for (const file of touched) {
    const before = await gitOr(["show", `${mergeBase}:${file}`], null);
    let a = {};
    let b = {};
    try {
      if (before !== null) a = JSON.parse(before);
      b = JSON.parse(await readFile(resolve(repoRoot, file), "utf8"));
    } catch {
      out.push({ file, keys: ["<unparseable>"] });
      continue;
    }
    const keys = PACKAGING_KEYS.filter(
      (k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]),
    );
    if (keys.length) out.push({ file, keys });
  }
  return out;
}

/**
 * Public surface present at the merge base and gone on HEAD.
 *
 * A removal is the one surface movement that breaks somebody who has already
 * shipped against it, which is why it is graded apart from an addition.
 * `surface:check` guarantees the committed manifest is current on any PR that
 * passes CI, so this can be read straight out of git rather than rebuilt.
 *
 * **The comparison is delegated to `scripts/surface/plan/diff.mjs`, not
 * reimplemented here.** The hand-rolled version this replaced flattened only
 * top-level names, so the removals people actually ship — a CLI flag, an MCP
 * tool parameter, an exit code — were invisible: `pnpm surface:plan` reported
 * `[removed] cli.commands.audit.flags.--chrome-path` while `pnpm pr:risk` graded
 * the same diff 🟡 medium and exited 0, skipping the §4b deprecation obligation
 * this rule exists to trigger. Two differs also drifted on their own key format,
 * and the local one emitted the literal string `"undefined"` for a missing
 * subpath — a phantom removal, i.e. a false 🔴.
 *
 * `diff.mjs` has zero imports, so it stays inside this file's node-core-only
 * constraint; `surface/index.mjs` imports it statically for that same reason.
 */
async function surfaceRemovals(mergeBase, files) {
  if (!files.includes("docs/surface.json")) return [];

  const before = await gitOr(["show", `${mergeBase}:docs/surface.json`], null);
  // Absent at the base is the honest "everything is new" case, not a failure.
  if (before === null) return [];

  // Fails CLOSED, both sides. The version this replaced caught every parse
  // error and returned `[]`, which meant DESTROYING the manifest graded LOWER
  // (medium, exit 0) than removing a single export from it (high, exit 1) — and
  // the base side counts, so the author needn't even touch the file.
  // `changedRootPackageKeys` already got this right and says why: unparseable on
  // either side is itself worth a human.
  let a, b;
  try {
    a = JSON.parse(before);
  } catch {
    return ["docs/surface.json at the merge base isn't valid JSON"];
  }
  try {
    b = JSON.parse(
      await readFile(resolve(repoRoot, "docs/surface.json"), "utf8"),
    );
  } catch {
    return ["docs/surface.json on this branch is missing or isn't valid JSON"];
  }

  let diffManifests;
  try {
    ({ diffManifests } = await import("./surface/plan/diff.mjs"));
  } catch (error) {
    // Also fails closed. In CI this file runs from a copy of the base branch's
    // `scripts/` tree, so a missing sibling means the workflow's extraction step
    // stopped matching this file's imports — which must be loud, not silent.
    die([
      `Can't load the surface differ — refusing to grade this diff.`,
      ``,
      `  ${error.message}`,
      ``,
      `  In CI, \`.github/workflows/pr-risk.yml\` extracts the base branch's whole`,
      `  \`scripts/\` tree so this import resolves. If you added an import here,`,
      `  make sure that step still covers it.`,
    ]);
  }

  return diffManifests(a, b)
    .filter((c) => c.kind === "removed")
    .map((c) => c.path);
}

// ---------------------------------------------------------------------------
// The rubric
// ---------------------------------------------------------------------------

const any = (files, re) => files.filter((f) => re.test(f));

/**
 * Ordered high → medium. Every rule names the damage it guards, because a rule
 * that can't name one is a rule that will eventually be argued away.
 *
 * `match` returns the evidence (an array of strings) or a falsy value. The
 * evidence is printed, so it has to be the thing a reader would go look at.
 */
const RULES = [
  {
    id: "ci-workflows",
    tier: "high",
    title: "CI or Actions machinery",
    why: "`publish.yml` holds `NPM_TOKEN` and pushes to the registry; `release-tag.yml` cuts tags. A wrong line here publishes, deletes, or leaks — and none of it is caught by the test suite, because the test suite is the thing being edited.",
    match: (f) => any(f.files, /^\.github\/(workflows|actions)\//),
  },
  {
    id: "review-policy",
    tier: "high",
    title: "Review or branch policy",
    why: "CODEOWNERS, the PR templates and this repo's agent skills decide who — or what — has to look at the next change. Weakening them is the one edit that makes every future edit less reviewed, and `.claude/skills/pr/SKILL.md` is where an agent's authority to merge without a human is granted. `CLAUDE.md` is that same authority in a different file: it is loaded into every agent session here and carries the merge rule itself (\"🟢 low — an agent may merge it\"), so widening that sentence hands agents the pull requests a human was meant to see.",
    match: (f) =>
      any(
        f.files,
        /^(\.github\/(CODEOWNERS|PULL_REQUEST_TEMPLATE|dependabot\.yml)|\.claude\/)/,
      ).concat(
        // Its own alternation because the anchor is different: `CLAUDE.md` is
        // matched by BASENAME, not by a root prefix, so a nested one — which
        // Claude Code loads for the subtree it sits in, with the same force —
        // grades the same as the root file. Only the root one exists today.
        //
        // It graded 🟡 medium as an unrecognised path until #328 put it on main,
        // which meant the file that tells every agent here when it may merge
        // without a human got LESS review than `.claude/`, and a PR editing only
        // it read as "the rubric has never heard of this" rather than as policy.
        //
        // Case-INSENSITIVE, for the reason the `breaking` rule below is: on a
        // case-insensitive checkout (macOS and Windows, git's default
        // `core.ignorecase`) a `git mv CLAUDE.md Claude.md` still loads for every
        // agent — the read resolves — while a case-sensitive pattern quietly
        // stops matching. A rule switched off by a capitalisation slip is the
        // failure mode that already cost this file a `Feat!:` escape.
        any(f.files, /(^|\/)CLAUDE\.md$/i),
      ),
  },
  {
    id: "verification-machinery",
    tier: "high",
    title: "What the gate actually checks",
    why: "`scripts/` is run by the workflows (`advance-latest.mjs` with `NPM_TOKEN` in scope, `list-publishable-packages.mjs` deciding what gets tagged), and `vitest.workspace.ts`, `tsconfig*`, `eslint.config.mjs`, `.size-limit.json` and `.husky/` decide what `pnpm verify` covers. Deleting one workspace entry makes `pnpm test` pass green while running none of that package's tests — the same damage the root manifest rule names, one level down.",
    match: (f) =>
      any(
        f.files,
        /^(scripts\/|\.husky\/|vitest\.workspace\.|tsconfig[^/]*\.json$|eslint\.config\.|\.size-limit\.json$|\.prettierrc|\.prettierignore$|\.gitattributes$)/,
      ),
  },
  {
    id: "release-config",
    tier: "high",
    title: "Release configuration",
    why: "`.changeset/config.json` decides which packages are `linked` and which are `ignore`d — i.e. what the next release publishes, and at what version. `pre.json` decides whether the repo is in prerelease mode at all.",
    match: (f) =>
      any(f.files, /^\.changeset\/(config|pre)\.json$/).concat(
        any(f.files, /^(pnpm-workspace\.yaml|\.npmrc)$/),
      ),
  },
  {
    id: "root-manifest",
    tier: "high",
    title: "Root manifest — build/publish keys",
    why: "The root `scripts`, `packageManager`, `engines` and `pnpm` overrides define what `pnpm verify` and the pre-push hook actually run. A change here can make CI pass by doing less.",
    // The only rule that watches a path it can then decline to fire on: the key
    // filter below ignores everything outside the build/publish set, so a root
    // `devDependencies` bump matches no rule and is in no `LOW_SHAPED` entry.
    // It therefore landed under "paths the rubric doesn't recognise", advising
    // the reader to add the ROOT MANIFEST to a list documented as harmless.
    //
    // `watches` says "considered, and deliberately not interesting" — distinct
    // from "never heard of it", which is what that section is for. Any future
    // rule that filters a watched path down to no evidence needs one too; every
    // other rule today either cites the path it matched or is scoped to a
    // LOW_SHAPED one, which is why this is the sole occurrence.
    watches: /^package\.json$/,
    match: (f) =>
      f.rootPackageKeys
        .filter((k) =>
          [
            "scripts",
            "packageManager",
            "engines",
            "pnpm",
            "workspaces",
            "<unparseable>",
          ].includes(k),
        )
        .map((k) => `package.json → ${k}`),
  },
  {
    id: "breaking",
    tier: "high",
    title: "Declared breaking change",
    why: "A `major` changeset, a `!` in the conventional subject, or a `BREAKING CHANGE:` footer is the author stating that consumers will have to change their code. That is the definition of needing a human.",
    match: (f) => [
      ...f.changesets
        .filter((c) => c.bump === "major")
        .map((c) => `${c.file} → ${c.package}: major`),
      // Case-INSENSITIVE. `feat!:` fired and `Feat!:` did not, and because the
      // repo squash-merges, the PR title becomes the only commit subject — so a
      // capitalisation slip silently switched off the rule whose own `why` reads
      // "the definition of needing a human". commitlint governs commit messages,
      // not PR titles, and GitHub doesn't normalise title case.
      ...[f.title ?? "", ...(f.subjects ?? [])]
        .filter((s) => /^[a-z]+(\([^)]*\))?!:/i.test(s))
        .map((s) => `subject: ${s}`),
      // Conventional Commits treats `!` and a `BREAKING CHANGE:` footer as
      // equivalent declarations. `f.body` is the PR description; `f.commitBodies`
      // is the commits' own, which `--format=%s` used to drop entirely — so a
      // commit declaring the break only in its footer graded 🟢 low.
      ...(/BREAKING[ -]CHANGE/.test(f.body ?? "")
        ? ["PR description: BREAKING CHANGE"]
        : []),
      ...(/BREAKING[ -]CHANGE/.test(f.commitBodies ?? "")
        ? ["commit body: BREAKING CHANGE"]
        : []),
    ],
  },
  {
    id: "release-pr",
    tier: "high",
    title: "Release cut",
    why: "A version-bump PR publishes to npm the moment it lands. It has its own workflow (`.claude/skills/release/SKILL.md`) which stops for explicit sign-off, and nothing here should route around that.",
    match: (f) => [
      ...(/^chore\(release\)/.test(f.title ?? "") ? [`title: ${f.title}`] : []),
      ...any(f.files, /^\.changeset\/pre\.json$/),
      ...any(f.files, /^docs\/surface\.released\.json$/),
    ],
  },
  {
    id: "extension-permissions",
    tier: "high",
    title: "Chrome extension manifest",
    why: "Permissions and host access in the extension manifest are a user-trust surface and a Chrome Web Store re-review trigger. The store release is manual and can't be rolled back by reverting a commit.",
    match: (f) =>
      any(f.files, /^packages\/extension\/.*manifest.*\.(json|ts)$/i),
  },
  {
    id: "packaging",
    tier: "high",
    title: "Package publishing shape",
    why: "`exports`, `files`, `types` and `private` decide whether an import resolves for everyone who installs the package — and a wrong `dts.resolve` half silently degrades published types to `any` rather than failing the build.",
    match: (f) =>
      f.packageManifests.map((m) => `${m.file} → ${m.keys.join(", ")}`),
  },
  {
    id: "build-config",
    tier: "high",
    title: "Package build configuration",
    why: "Same blast radius as the manifest: what tsup emits is what consumers get, and the failure mode is a published artifact that imports cleanly and is wrong, not a red build.",
    match: (f) =>
      any(f.files, /^packages\/[^/]+\/(tsup|vite|rollup)\.config\./),
  },
  {
    id: "surface-removal",
    tier: "high",
    title: "Public surface removed",
    why: "Something in the manifest at the merge base is gone on HEAD. Additions are free; removals break whoever already shipped against them, and oblige a deprecation in the scenario suites (§4b).",
    match: (f) => f.surfaceRemovals,
  },
  {
    id: "secrets-and-redaction",
    tier: "high",
    title: "Redaction boundary or credential handling",
    why: "Preview URLs carry tokens, and this tool writes files that get posted into PR comments. A field derived from a raw url next to one derived from the redacted url is the signature of a leak — it shipped twice in one PR here. Removing a redaction call counts too, and is the most direct way to bring the leak back.",
    match: (f) => {
      const hits = new Set();
      // Boundaries are `(?<![A-Za-z0-9_])` / `(?![A-Za-z0-9])` rather than `\b`.
      // `\b` does not fire next to `_`, and a trailing `\b` blocks every suffix,
      // so the rule missed `storageStatePath`, `MY_NPM_TOKEN`,
      // `CHROME_CLIENT_SECRET_PATH` — and `redactUrlsIn`, which is this repo's
      // OWN bulk redaction helper (packages/snapshot/src/sanitize.ts), used by
      // snapshot, cli and the daemon. A PR adding redaction via the plural
      // helper was silently not flagged.
      for (const m of f.touchedCode.matchAll(
        /(?<![A-Za-z0-9_])(redactUrl|sanitizeUrl|storageState|NPM_TOKEN|GITHUB_TOKEN|CHROME_[A-Z_]*(?:TOKEN|SECRET)|client_secret|refresh_token)(?![A-Za-z0-9])/g,
      )) {
        hits.add(m[1]);
      }
      return [...hits].map((h) => `touched code references \`${h}\``);
    },
    // A rule whose pattern lists the very tokens it hunts will always match its
    // own source. It did: the PR introducing this rule was graded 🔴 by the rule
    // matching itself, and the public comment carried seven meaningless bullets.
    // Seven bullets of noise on the first PR is how a rule stops being read.
    excludeSelf: true,
  },

  {
    id: "published-src",
    tier: "medium",
    title: "Published package source",
    why: "Anything under a published package's `src` reaches users at the next release. Covered by the suite, so the tier is medium rather than high — but it is not a change the CI gate alone should be trusted to bless.",
    match: (f) => any(f.files, /^packages\/[^/]+\/src\//),
  },
  {
    id: "surface-addition",
    tier: "medium",
    title: "Public surface added or changed",
    why: "A new command, tool, flag, export or env var is a support obligation from the moment it ships, and §4/§4b oblige docs and a scenario in the same PR.",
    match: (f) => any(f.files, /^docs\/surface\.json$/),
  },
  {
    id: "dependencies",
    tier: "medium",
    title: "Dependency graph",
    why: "A transitive bump can change runtime behaviour with no diff in this repo at all. The lockfile is where that becomes real.",
    match: (f) => any(f.files, /^pnpm-lock\.yaml$/),
  },
  {
    id: "scenarios",
    tier: "medium",
    title: "Release test scenarios",
    why: "The Regression and Dogfood suites are how a release gets checked by a human. Editing one changes what the next release is allowed to conclude.",
    match: (f) => any(f.files, /^scenarios\//),
  },
];

/**
 * The paths a 🟢 low verdict is allowed to be made of — an ALLOW-LIST.
 *
 * This is the difference between "the rubric found nothing" and "the rubric
 * recognised everything". Previously anything unmatched fell into an `"other"`
 * bucket that still graded low, so any path the rubric had never heard of was
 * agent-mergeable by default — which for a control whose entire job is blast
 * radius is the wrong way round. Unknown now means 🟡 medium: a human looks, and
 * whoever adds the path here says which bucket it belongs in.
 */
const LOW_SHAPED = [
  [/^website\//, "docs site"],
  [
    /^(README|CONTRIBUTING|CHANGELOG|SUPPORT|CODE_OF_CONDUCT|SECURITY)\.md$/,
    "root docs",
  ],
  [/^packages\/[^/]+\/(README|CHANGELOG)\.md$/, "package docs"],
  [/^docs\/(?!surface).*\.md$/, "internal docs"],
  [/^examples\//, "examples"],
  [/\.(test|spec)\.[cm]?[jt]sx?$/, "tests"],
  [/^packages\/[^/]+\/src\/__(tests|fixtures|snapshots)__\//, "test fixtures"],
  [/^\.changeset\/[^/]+\.md$/, "changeset entries"],
  [/^\.github\/ISSUE_TEMPLATE\//, "issue templates"],
];

/**
 * Did a named rule already point at this file?
 *
 * A path a rule cited is, by definition, recognised, so it must not also appear
 * under "paths the rubric doesn't recognise". It did: every rule-matched path was
 * printed in BOTH sections of the same comment — #320 listed its two scenario
 * files directly beneath the "Release test scenarios" rule that named them, and
 * #318 did it for seven of nine, including the extension manifest.
 *
 * The grade was never wrong. Every entry in `RULES` is high or medium, so a
 * matched file already forces at least medium on its own and `unrecognised`
 * added nothing. The harm was the advice attached to that section — "add the path
 * to `LOW_SHAPED` if it genuinely is [harmless]" — which, followed to quiet the
 * noise, moves every package manifest or scenario file into a list documented as
 * harmless. A control that invites you to mislabel the paths it cares most about
 * is worse than one that says nothing.
 *
 * Evidence is free text rather than paths, so this matches by prefix: rules emit
 * bare paths from `any(f.files, …)` next to decorated forms (`<path> → version`,
 * `<path> → <pkg>: major`) and tokens that are not paths at all (`title: …`,
 * `subject: …`). Requiring a SPACE after the path is what stops `a/foo.json`
 * from claiming `a/foo.json.bak → version`.
 */
function cited(evidenceSeen, file) {
  if (evidenceSeen.has(file)) return true;
  for (const e of evidenceSeen) if (e.startsWith(`${file} `)) return true;
  return false;
}

function classify(facts) {
  const reasons = [];
  // Every evidence string any rule produced, UNtruncated — `cited()` reads this
  // rather than `reason.evidence`, which is sliced to 12 for display. Reusing the
  // display copy would leave file 13 of a wide rule looking unclassified.
  const evidenceSeen = new Set();
  for (const rule of RULES) {
    // A rule flagged `excludeSelf` is scanned against a diff with this file's
    // own hunks removed, so a pattern listing the tokens it hunts cannot match
    // its own source text.
    const view = rule.excludeSelf
      ? { ...facts, touchedCode: facts.touchedCodeExcludingSelf }
      : facts;
    const evidence = rule.match(view);
    if (evidence && evidence.length) {
      const unique = [...new Set(evidence)];
      for (const e of unique) evidenceSeen.add(e);
      reasons.push({ ...rule, evidence: unique.slice(0, 12) });
    }
  }

  // What a verdict is made of, and — for anything unrecognised — the paths that
  // forced it up a tier, so the fix (classify the path) is obvious.
  //
  // Three ways a path counts as recognised, in order: it is low-shaped, a rule
  // cited it, or a rule WATCHES it but declined to fire. Only the third needs
  // explaining — see `watches` on `root-manifest`.
  const shape = new Set();
  const unrecognised = [];
  for (const file of facts.files) {
    const low = LOW_SHAPED.find(([re]) => re.test(file));
    if (low) {
      shape.add(low[1]);
      continue;
    }
    if (cited(evidenceSeen, file)) continue;
    const watcher = RULES.find((r) => r.watches?.test(file));
    if (watcher) {
      shape.add(watcher.id);
      continue;
    }
    unrecognised.push(file);
  }
  if (unrecognised.length) shape.add("unrecognised");

  const tier = reasons.some((r) => r.tier === "high")
    ? "high"
    : reasons.length || unrecognised.length
      ? "medium"
      : "low";

  return { tier, reasons, shape: [...shape], unrecognised };
}

// ---------------------------------------------------------------------------
// Which CI jobs this diff can actually affect
// ---------------------------------------------------------------------------

/**
 * A DIFFERENT question from the tier, deliberately kept apart.
 *
 * "How much review does this need" and "which test jobs can this break" are not
 * the same axis, and conflating them gets both wrong: a `.github/workflows` edit
 * is 🔴 high and runs no package code, while a one-line `packages/core/src` fix
 * is 🟡 medium and must run everything. So `test.yml` reads this, not `tier`.
 *
 * It lives here rather than in the workflow because the repo's path taxonomy
 * should have ONE definition. Two lists of "what counts as docs" drift, and the
 * drift is invisible until the day the skipped job was the one that mattered.
 *
 * Everything not proven inert counts as code. That direction is the whole point:
 * the cost of a wrong "inert" is a real failure that never ran, and the cost of a
 * wrong "code" is a few wasted minutes.
 */
const CI_INERT = [
  /^(README|CONTRIBUTING|CHANGELOG|SUPPORT|CODE_OF_CONDUCT|SECURITY)\.md$/,
  /^packages\/[^/]+\/(README|CHANGELOG)\.md$/,
  /^docs\/(?!surface).*\.md$/,
  /^\.changeset\/[^/]+\.md$/,
  // Templates, ownership and bot config: reviewed carefully (they are 🔴 high),
  // but they cannot change what any test asserts. `.github/workflows/` is NOT
  // here — a workflow edit may be the very thing that needs exercising.
  /^\.github\/(ISSUE_TEMPLATE\/|PULL_REQUEST_TEMPLATE)/,
  /^\.github\/(CODEOWNERS|FUNDING\.yml|dependabot\.yml)$/,
  /^\.claude\//,
  // Same bucket as `.claude/`, and for the same reason: agent instruction is
  // 🔴 high to review and asserted by no test. Both halves of the taxonomy have
  // to name it — leaving it out here would run the full matrix, e2e included,
  // on a PR that edits one paragraph of prose. Cased like the rule above so the
  // two halves cannot disagree about what the same path is.
  /(^|\/)CLAUDE\.md$/i,
  /^scenarios\//,
  /^\.vscode\//,
  /^\.idea\//,
];

function ciNeeds(files) {
  const website = files.some((f) => /^website\//.test(f));
  const code = files.some(
    (f) => !/^website\//.test(f) && !CI_INERT.some((re) => re.test(f)),
  );
  return {
    // The package matrix, e2e, the example apps, Node 24 — everything that
    // exercises built output.
    code,
    // The docs site's own axe baselines and dead-link build.
    website,
    // `verify` always runs at least once: it carries format:check and lint,
    // which any text file can break. Only its BREADTH is conditional.
    matrix: code
      ? { node: [20, 22], os: ["ubuntu-latest", "macos-latest"] }
      : { node: [20], os: ["ubuntu-latest"] },
  };
}

// ---------------------------------------------------------------------------
// What the tier means
// ---------------------------------------------------------------------------

const POLICY = {
  low: {
    review: "CI only — no deep review pass.",
    merge:
      "An agent may merge it: wait for green (`gh pr checks --watch`), confirm `mergeStateStatus` is `CLEAN`, then `gh pr merge --squash --delete-branch`.",
  },
  medium: {
    review:
      "Run `/code-review` over the branch diff before pushing for review.",
    merge: "A human merges. An agent must not.",
  },
  high: {
    // Names ONLY skills that exist. This used to name `/a11y-review`, which is
    // not a repo skill and not a session one — so every high PR got a blocking
    // check whose one documented clearance instruction could not be carried out,
    // and §3a's "say which ran" could only be answered falsely. A gate whose
    // clearance step is unrunnable teaches people to route around the gate,
    // which is the exact failure this file's header is built against.
    review:
      "Run `/code-review` and `/security-review`, and work §4b's scenario table explicitly. Say in the PR body which ran.",
    merge:
      "A human merges, after the deep review is on record (`reviewed:deep`).",
  },
};

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

const BADGE = { low: "🟢 low", medium: "🟡 medium", high: "🔴 high" };

function renderText({ tier, reasons, shape, unrecognised }, facts) {
  const out = [
    ``,
    `Risk: ${BADGE[tier].toUpperCase()}  (${facts.files.length} files, ${facts.lines} lines, vs ${facts.base})`,
    ``,
    `  Review: ${POLICY[tier].review}`,
    `  Merge:  ${POLICY[tier].merge}`,
    ``,
  ];
  if (reasons.length) {
    out.push(`Why:`, ``);
    for (const r of reasons) {
      out.push(`  [${r.tier}] ${r.title}`);
      for (const e of r.evidence) out.push(`      ${e}`);
      out.push(``);
    }
  }
  if (unrecognised.length) {
    out.push(
      `Paths the rubric doesn't recognise (medium until one of us classifies them):`,
      ``,
      ...unrecognised.slice(0, 12).map((f) => `      ${f}`),
      ``,
    );
  }
  if (!reasons.length && !unrecognised.length) {
    out.push(
      `Nothing in the rubric matched. The diff is: ${shape.join(", ")}.`,
      ``,
    );
  }
  return out.join("\n");
}

/**
 * Author-written text, rendered so it cannot become markup.
 *
 * Evidence quotes the PR title and commit subjects — attacker-controlled text,
 * as this file's own header says, which is the realisation that already forced
 * the argv parser rewrite. The same input was still trusted one layer down: the
 * fence was hard-coded at two backticks, and CommonMark closes a two-backtick
 * span at the next run of exactly two. A title containing ``two`` therefore
 * escaped the span, so a link rendered live, `@everyone` became a real mention,
 * and `</summary>` closed the `<details>` block and let the author replace the
 * risk verdict with their own text — under `github-actions[bot]`'s identity, on
 * the comment §0 tells reviewers and agents to read.
 *
 * HTML-escaping into a literal `<code>` needs no fence arithmetic and cannot be
 * closed from the inside, so there is no n+1 rule to get wrong later.
 */
const asCode = (s) =>
  `<code>${String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</code>`;

function renderMarkdown({ tier, reasons, shape, unrecognised }, facts) {
  const out = [
    `### ${BADGE[tier]} risk`,
    ``,
    `${facts.files.length} files, ${facts.lines} lines changed against \`${facts.base}\`.`,
    ``,
    `| | |`,
    `| --- | --- |`,
    `| **Review** | ${POLICY[tier].review} |`,
    `| **Merge** | ${POLICY[tier].merge} |`,
    ``,
  ];

  if (reasons.length) {
    out.push(`<details open><summary><b>Why</b></summary>`, ``);
    for (const r of reasons) {
      out.push(
        `**${BADGE[r.tier].split(" ")[0]} ${r.title}** — ${r.why}`,
        ``,
        ...r.evidence.map((e) => `- ${asCode(e)}`),
        ``,
      );
    }
    out.push(`</details>`, ``);
  }

  if (unrecognised.length) {
    out.push(
      `<details><summary><b>${unrecognised.length} path(s) the rubric doesn't recognise</b> — medium until classified</summary>`,
      ``,
      ...unrecognised.slice(0, 12).map((f) => `- ${asCode(f)}`),
      ``,
      `Unknown paths grade 🟡 medium rather than 🟢 low on purpose: for a control that measures blast radius, "never heard of it" is not the same as "harmless". Add the path to \`LOW_SHAPED\` in \`scripts/pr-risk.mjs\` if it genuinely is.`,
      ``,
      `</details>`,
      ``,
    );
  }

  if (!reasons.length && !unrecognised.length) {
    out.push(
      `No rule matched: the diff is ${shape.map((s) => `_${s}_`).join(", ")}.`,
      ``,
    );
  }

  if (tier === "high") {
    out.push(
      `> This check stays red until the deep review is on record. Run the review passes named above, then add the **\`reviewed:deep\`** label — it is cleared automatically whenever the head changes, so it always means "reviewed at this diff". If a rule fired on something genuinely inert, add **\`risk-override\`** and put the reason in the description; the check reads it back.`,
      ``,
    );
  }

  out.push(
    `_Rubric: \`scripts/pr-risk.mjs\`. Tiers and what they oblige: the \`pr\` skill, §0. Run it yourself with \`pnpm pr:risk\`._`,
  );
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/**
 * Flags that take a value, and flags that are on/off. Both sets are closed, and
 * that is the security-relevant part rather than a tidiness one.
 *
 * The parser this replaced was `argv.indexOf('--x')`, which cannot tell a flag
 * from a flag's VALUE — and the workflow passes the PR title, which the PR
 * author writes. A pull request titled `--override` put that string in argv, the
 * `indexOf` found it, and the high-risk gate passed. Titling it `--reviewed` did
 * the same. So the one check standing between "touches publish.yml" and "merged
 * unreviewed" could be turned off by anyone who could open a PR.
 *
 * Consuming the next argv item as an opaque value is what fixes it: after
 * `--title`, whatever follows is data and is never read as a flag again.
 */
const VALUE_FLAGS = new Set(["base", "format", "title", "body", "repo"]);
const BOOL_FLAGS = new Set(["gate", "reviewed", "override"]);

function parseArgs(argv) {
  const values = new Map();
  const bools = new Set();

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const eq = arg.indexOf("=");
    const name = arg.startsWith("--")
      ? arg.slice(2, eq === -1 ? undefined : eq)
      : null;

    if (name === null || (!VALUE_FLAGS.has(name) && !BOOL_FLAGS.has(name))) {
      die([
        `Unknown argument: ${arg}`,
        ``,
        `  usage: node scripts/pr-risk.mjs [--base <ref>] [--format text|markdown|json]`,
        `                                  [--repo <path>] [--title <s>] [--body <s>]`,
        `                                  [--gate] [--reviewed] [--override]`,
      ]);
    }

    if (VALUE_FLAGS.has(name)) {
      // `--name=value` or `--name value`. The latter takes whatever is next,
      // dash-prefixed or not — see above.
      values.set(name, eq === -1 ? (argv[++i] ?? "") : arg.slice(eq + 1));
    } else {
      bools.add(name);
    }
  }

  return { values, bools };
}

const { values, bools } = parseArgs(process.argv.slice(2));
const flag = (name, fallback) => values.get(name) ?? fallback;

const base = flag("base", "origin/main");
const format = flag("format", "text");
// Set before anything touches git — every read below runs with `cwd: repoRoot`.
if (values.has("repo")) repoRoot = resolve(flag("repo"));

const facts = await collectFacts(base);

// Locally there is no PR, so this branch's own commit subjects stand in for a
// title — a `feat!:` commit should read as breaking before the PR carrying it
// exists. Scoped to `<mergeBase>..HEAD` rather than `-1 HEAD`: on a branch with
// no commits yet, `-1` returns main's tip, which is somebody else's subject and
// has fired this rule for a `refactor(...)!:` the author had nothing to do with.
//
// All of them, not just the newest. A branch whose middle commit is the breaking
// one is still a breaking branch, and squash-merge means that subject may well be
// the only place it was ever written down.
facts.subjects = splitZ(
  await gitOrDie(
    ["log", `${facts.mergeBase}..HEAD`, "-z", "--format=%s"],
    "this branch's commit subjects",
  ),
).filter(Boolean);

// The commits' own message BODIES, separately from their subjects. Conventional
// Commits treats a `BREAKING CHANGE:` footer as equivalent to `!`, and it lives
// in the body — which `--format=%s` dropped entirely, so a commit declaring the
// break only in its footer graded 🟢 low. NUL-separated so a multi-line body
// can't be mistaken for several commits.
facts.commitBodies = splitZ(
  await gitOrDie(
    ["log", `${facts.mergeBase}..HEAD`, "-z", "--format=%b"],
    "this branch's commit bodies",
  ),
).join("\n");

facts.title = flag("title") ?? facts.subjects[0] ?? "";
facts.body = flag("body", "");

const result = classify(facts);

if (format === "json") {
  console.log(
    JSON.stringify(
      {
        tier: result.tier,
        shape: result.shape,
        unrecognised: result.unrecognised,
        files: facts.files.length,
        lines: facts.lines,
        reasons: result.reasons.map(({ id, tier, title, evidence }) => ({
          id,
          tier,
          title,
          evidence,
        })),
        policy: POLICY[result.tier],
        ci: ciNeeds(facts.files),
      },
      null,
      2,
    ),
  );
} else if (format === "markdown") {
  console.log(renderMarkdown(result, facts));
} else {
  console.log(renderText(result, facts));
}

// The gate, and the only path that exits non-zero. A high-risk PR is not a
// failure — an UNREVIEWED high-risk PR is, and the difference is the label,
// which is why this is a flag rather than a property of the tier.
if (bools.has("gate")) {
  const reviewed = bools.has("reviewed");

  // `risk-override` demands a written reason, and may name the rules it waives.
  //
  // The label alone used to clear the gate while `renderMarkdown` claimed "the
  // override is recorded, not silent" — but nothing read the body, so the only
  // artifact was a label the same person could remove after merge. Reading the
  // reason back is what makes that sentence true. Naming rules is optional and
  // narrows the waiver, so overriding one misfiring rule stops silently waiving
  // `ci-workflows`, `packaging` and `secrets-and-redaction` alongside it.
  //
  //   risk-override: the workflow edit is a comment typo
  //   risk-override: packaging — version bump only, no exports moved
  let overridden = false;
  if (bools.has("override")) {
    const line = (facts.body ?? "").match(/^\s*risk-override:\s*(.+)$/im)?.[1];
    if (!line?.trim()) {
      die([
        `The \`risk-override\` label is set, but no reason is recorded.`,
        ``,
        `  Put a line in the PR description saying what misfired and why it is inert:`,
        ``,
        `    risk-override: <reason>`,
        `    risk-override: <rule-id>[, <rule-id>] — <reason>`,
        ``,
        `  Rules that fired: ${result.reasons
          .filter((r) => r.tier === "high")
          .map((r) => r.id)
          .join(", ")}`,
        ``,
        `  A waiver nobody has to justify is one that gets applied by habit, and`,
        `  then it means nothing on the PR where it mattered.`,
      ]);
    }

    const [, named, reason] = line.match(/^([^—:]*?)\s*[—:]\s*(.+)$/) ?? [];
    const ids = (named ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => RULES.some((r) => r.id === s));

    if (ids.length) {
      const remaining = result.reasons.filter(
        (r) => r.tier === "high" && !ids.includes(r.id),
      );
      overridden = remaining.length === 0;
      if (!overridden) {
        die([
          `\`risk-override\` waives ${ids.join(", ")}, but other high rules fired:`,
          ``,
          ...remaining.map((r) => `    ${r.id} — ${r.title}`),
          ``,
          `  Name them too, or review them. Reason on record: ${reason}`,
        ]);
      }
      console.log(`\nOverride accepted for ${ids.join(", ")} — ${reason}\n`);
    } else {
      overridden = true;
      console.log(`\nOverride accepted (all rules) — ${line.trim()}\n`);
    }
  }

  if (result.tier === "high" && !reviewed && !overridden) {
    die([
      `High-risk change without a recorded deep review.`,
      ``,
      `  ${result.reasons
        .filter((r) => r.tier === "high")
        .map((r) => r.title)
        .join(", ")}`,
      ``,
      `  Run the passes named above, then add the \`reviewed:deep\` label — it is`,
      `  dropped automatically whenever the head changes, so it always means`,
      `  "reviewed at this diff" rather than "reviewed once".`,
      ``,
      `  If a rule fired on something inert, \`risk-override\` plus a reason in the`,
      `  description clears it. The reason is required: the check reads the body`,
      `  back and refuses an empty one.`,
    ]);
  }
}
