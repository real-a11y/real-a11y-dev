// What a pull request here is risking — computed from its diff, not judged.
//
//   node scripts/pr-risk.mjs                        the tier + why, as text
//   node scripts/pr-risk.mjs --format markdown      the PR comment body
//   node scripts/pr-risk.mjs --format json          for a workflow to read
//   node scripts/pr-risk.mjs --gate --reviewed      exit 1 if high risk is unreviewed
//
// Three tiers, and the tier decides two things: how deep the review goes
// (`.claude/skills/pr/SKILL.md` §0) and whether an agent may merge the PR
// itself instead of leaving it for a human (§8).
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
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const repoRoot = resolve(fileURLToPath(import.meta.url), "../..");

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
  const files = [
    ...(await gitOr(["diff", "--name-only", mergeBase], "")).split("\n"),
    ...(await gitOr(["ls-files", "--others", "--exclude-standard"], "")).split(
      "\n",
    ),
  ].filter(Boolean);

  const numstat = (await gitOr(["diff", "--numstat", mergeBase], ""))
    .split("\n")
    .filter(Boolean);
  const lines = numstat.reduce((n, row) => {
    const [added, removed] = row.split("\t");
    // Binary files report `-`; they contribute files but not lines.
    return n + (Number(added) || 0) + (Number(removed) || 0);
  }, 0);

  // Added lines only, and only from the file types that can carry a secret or a
  // redaction boundary. Scoped this narrowly because the alternative — the whole
  // diff — is unbounded on a PR that regenerates a snapshot fixture, and the
  // rule reading it cares about code, not data.
  const codeDiff = await gitOr(
    [
      "diff",
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
    "",
  );
  const addedCode = codeDiff
    .split("\n")
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
    .join("\n");

  return {
    base,
    mergeBase,
    files,
    lines,
    addedCode,
    changesets: await readChangesets(),
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
async function readChangesets() {
  let entries;
  try {
    entries = await readdir(resolve(repoRoot, ".changeset"));
  } catch {
    return [];
  }

  const out = [];
  for (const name of entries) {
    if (!name.endsWith(".md") || name.toLowerCase() === "readme.md") continue;
    let text;
    try {
      text = await readFile(resolve(repoRoot, ".changeset", name), "utf8");
    } catch {
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

/** Publish-shaping keys — see PACKAGING_KEYS' rule for why each one is here. */
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
  "publishConfig",
  "dependencies",
  "peerDependencies",
  "optionalDependencies",
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

/** Every identity in the surface manifest, flattened to comparable strings. */
function surfaceIdentities(manifest) {
  const ids = new Set();
  if (!manifest || typeof manifest !== "object") return ids;
  for (const c of manifest.cli?.commands ?? [])
    ids.add(`cli command ${c.name}`);
  for (const t of manifest.mcp?.tools ?? []) ids.add(`mcp tool ${t.name}`);
  for (const p of manifest.packages ?? []) ids.add(`package ${p.name}`);
  for (const e of manifest.env ?? []) ids.add(`env ${e.name}`);
  for (const pkg of manifest.api ?? []) {
    for (const entry of pkg.entries ?? []) {
      for (const v of [...(entry.values ?? []), ...(entry.types ?? [])]) {
        ids.add(`export ${pkg.name}${entry.subpath?.replace(/^\.$/, "")} ${v}`);
      }
    }
  }
  return ids;
}

/**
 * Surface identities that exist at the merge base and don't exist on HEAD.
 *
 * A removal is the one surface movement that is a break for somebody who has
 * already shipped against it, which is why it is graded apart from an addition.
 * `surface:check` guarantees the committed manifest is current on any PR that
 * passes CI, so this can be read straight out of git rather than rebuilt.
 */
async function surfaceRemovals(mergeBase, files) {
  if (!files.includes("docs/surface.json")) return [];
  const before = await gitOr(["show", `${mergeBase}:docs/surface.json`], null);
  if (before === null) return [];
  let a, b;
  try {
    a = JSON.parse(before);
    b = JSON.parse(
      await readFile(resolve(repoRoot, "docs/surface.json"), "utf8"),
    );
  } catch {
    return [];
  }
  const head = surfaceIdentities(b);
  return [...surfaceIdentities(a)].filter((id) => !head.has(id));
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
    id: "codeowners",
    tier: "high",
    title: "Review or branch policy",
    why: "CODEOWNERS and the issue/PR templates decide who has to look at the next change. Weakening them is the one edit that makes every future edit less reviewed.",
    match: (f) => any(f.files, /^\.github\/CODEOWNERS$/),
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
    why: "A `major` changeset or a `!` in the conventional title is the author stating that consumers will have to change their code. That is the definition of needing a human.",
    match: (f) => [
      ...f.changesets
        .filter((c) => c.bump === "major")
        .map((c) => `${c.file} → ${c.package}: major`),
      ...[f.title ?? "", ...(f.subjects ?? [])]
        .filter((s) => /^[a-z]+(\([^)]*\))?!:/.test(s))
        .map((s) => `subject: ${s}`),
      ...(/BREAKING[ -]CHANGE/.test(f.body ?? "")
        ? ["body: BREAKING CHANGE"]
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
    why: "Preview URLs carry tokens, and this tool writes files that get posted into PR comments. A field derived from a raw url next to one derived from the redacted url is the signature of a leak — it shipped twice in one PR here.",
    match: (f) => {
      const hits = new Set();
      for (const m of f.addedCode.matchAll(
        /\b(redactUrl|sanitizeUrl|storageState|NPM_TOKEN|GITHUB_TOKEN|CHROME_[A-Z_]*(TOKEN|SECRET)|client_secret|refresh_token)\b/g,
      )) {
        hits.add(m[1]);
      }
      return [...hits].map((h) => `added code references \`${h}\``);
    },
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

/** Paths that can only ever be low — used to explain a low verdict, not reach it. */
const LOW_SHAPED = [
  [/^website\//, "docs site"],
  [
    /^(README|CONTRIBUTING|CHANGELOG|SUPPORT|CODE_OF_CONDUCT|SECURITY)\.md$/,
    "root docs",
  ],
  [/^packages\/[^/]+\/(README|CHANGELOG)\.md$/, "package docs"],
  [/^examples\//, "examples"],
  [/^\.claude\//, "agent skills"],
  [/\.(test|spec)\.[cm]?[jt]sx?$/, "tests"],
  [/^\.changeset\/[^/]+\.md$/, "changeset entries"],
];

function classify(facts) {
  const reasons = [];
  for (const rule of RULES) {
    const evidence = rule.match(facts);
    if (evidence && evidence.length) {
      reasons.push({ ...rule, evidence: [...new Set(evidence)].slice(0, 12) });
    }
  }

  const tier = reasons.some((r) => r.tier === "high")
    ? "high"
    : reasons.length
      ? "medium"
      : "low";

  // What a low verdict is actually made of, so "low" reads as an observation
  // rather than as the rubric having failed to notice something.
  const shape = new Set();
  for (const file of facts.files) {
    const hit = LOW_SHAPED.find(([re]) => re.test(file));
    shape.add(hit ? hit[1] : "other");
  }

  return { tier, reasons, shape: [...shape] };
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
    review:
      "Run `/code-review`, `/security-review` and `/a11y-review`, and work §4b's scenario table explicitly. Say in the PR body which ran.",
    merge:
      "A human merges, after the deep review is on record (`reviewed:deep`).",
  },
};

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

const BADGE = { low: "🟢 low", medium: "🟡 medium", high: "🔴 high" };

function renderText({ tier, reasons, shape }, facts) {
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
  } else {
    out.push(
      `Nothing in the rubric matched. The diff is: ${shape.join(", ")}.`,
      ``,
    );
  }
  return out.join("\n");
}

function renderMarkdown({ tier, reasons, shape }, facts) {
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
        // Evidence can quote the PR title, which its author writes and which
        // this renders straight into a comment we post. A backtick in it would
        // close the code span and let the rest render as markdown; doubling the
        // fence and padding is the standard way to hold a literal backtick.
        ...r.evidence.map((e) =>
          e.includes("`") ? `- \`\` ${e} \`\`` : `- \`${e}\``,
        ),
        ``,
      );
    }
    out.push(`</details>`, ``);
  } else {
    out.push(
      `No rule matched: the diff is ${shape.map((s) => `_${s}_`).join(", ")}.`,
      ``,
    );
  }

  if (tier === "high") {
    out.push(
      `> This check stays red until the deep review is on record. Run the three review passes, then add the **\`reviewed:deep\`** label. If a rule fired on something genuinely inert, add **\`risk-override\`** and say why in the description — the override is recorded, not silent.`,
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
const VALUE_FLAGS = new Set(["base", "format", "title", "body"]);
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
        `                                  [--title <s>] [--body <s>]`,
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
facts.subjects = (
  await gitOr(["log", `${facts.mergeBase}..HEAD`, "--format=%s"], "")
)
  .split("\n")
  .filter(Boolean);
facts.title = flag("title") ?? facts.subjects[0] ?? "";
facts.body = flag("body", "");

const result = classify(facts);

if (format === "json") {
  console.log(
    JSON.stringify(
      {
        tier: result.tier,
        shape: result.shape,
        files: facts.files.length,
        lines: facts.lines,
        reasons: result.reasons.map(({ id, tier, title, evidence }) => ({
          id,
          tier,
          title,
          evidence,
        })),
        policy: POLICY[result.tier],
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
  const overridden = bools.has("override");
  if (result.tier === "high" && !reviewed && !overridden) {
    die([
      `High-risk change without a recorded deep review.`,
      ``,
      `  ${result.reasons
        .filter((r) => r.tier === "high")
        .map((r) => r.title)
        .join(", ")}`,
      ``,
      `  Run the three passes named above, then add the \`reviewed:deep\` label.`,
      `  If a rule fired on something inert, \`risk-override\` + a reason in the`,
      `  description clears it — recorded, not silent.`,
    ]);
  }
}
