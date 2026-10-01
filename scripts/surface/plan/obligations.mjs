// Which documents a surface change obliges you to update, and what happens to
// the release test scenarios.
//
// This is the `pr` skill's §4 and §4b tables, encoded. Encoded rather than
// recited because the skill's own framing is that the mapping is the part
// people get wrong: the table is read once, remembered approximately, and the
// page that gets missed is always the same one — `website/index.md`, the home
// page, which is both the most visible and the least obviously "documentation".
//
// It reads the checkout, synchronously, so that it never names a page that does
// not exist or that never mentioned the package. `node:fs` is the only thing
// that adds, which keeps the rule `plan` runs under — node core and `git`, no
// install, no build — intact; see the import note in scripts/surface/index.mjs.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Every page that enumerates the published packages. From the skill's
 * "brand-new published package or product surface" row — the heaviest
 * obligation in the repo.
 *
 * The list applies WHOLE in the arriving direction — a newly published package
 * has to be ADDED to every page that enumerates what you can install, and a page
 * that doesn't name it yet is precisely the one to edit.
 *
 * Leaving inverts the question. Unpublishing means a page tells people to
 * install something they can't, which is worse because the instructions are
 * still there and still look right — but that is only true of the pages that
 * name it. `website/index.md`, `getting-started.md` and `why.md` never mentioned
 * `validate` or `semantic-navigator-ui`, so demanding the whole list on the PR
 * that privatized them made three of its demands unactionable. That direction is
 * filtered by `namesPackage` below.
 *
 * That filter is also why this list should be GENEROUS rather than minimal. An
 * entry a page doesn't mention costs nothing on the way out — it is dropped
 * before it is reported — so a wrong entry costs one unactionable line on the
 * arriving event, while a missing one costs silence. The short list had that
 * backwards, and the PR that privatized both packages is the proof: it held six
 * paths, `SECURITY.md`, `website/privacy.md` and `.github/PULL_REQUEST_TEMPLATE.md`
 * were left still naming the two as published, and the report said "every doc in
 * scope was touched" — short, confident, wrong. Anything that enumerates the
 * packages by name belongs here, not only the pages under `website/`.
 */
const PUBLISHED_PACKAGE_DOCS = [
  "README.md",
  "SECURITY.md",
  "website/index.md",
  "website/privacy.md",
  "website/guide/architecture.md",
  "website/guide/getting-started.md",
  "website/guide/agent-skills.md",
  "website/guide/why.md",
  ".github/PULL_REQUEST_TEMPLATE.md",
  ".changeset/config.json",
];

/**
 * Every `packages/<dir>/README.md`, read off the checkout — for the LEAVING
 * direction only.
 *
 * A package README says `npm install @real-a11y-dev/<name>`, so it belongs to
 * this obligation. It is not in the list above because that list applies WHOLE
 * when a package ARRIVES, and publishing `snapshot` obliges nothing in the other
 * fourteen READMEs. The one it does oblige — its own — can't be singled out here
 * anyway: the directory isn't derivable from the scoped name, since
 * `@real-a11y-dev/semantic-navigator-ui` lives in `packages/ui`.
 *
 * Leaving reverses that. "Which README still tells someone to install this?" has
 * no curated answer — it is a search, and `namesPackage` is the search.
 * `packages/audit/README.md` is the case that proves it: a whole section on
 * `audit` vs `validate`, linking twice to `real-a11y.dev/packages/validate`, a
 * page that has never existed. No entry in the list above could have found it,
 * because the mention lives in a SIBLING's README.
 *
 * A missing README needs no guard: `namesPackage` tries to read it, fails, and
 * reports that it names nothing, which is the right answer.
 */
function packageReadmes(repoRoot) {
  try {
    return readdirSync(join(repoRoot, "packages"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `packages/${entry.name}/README.md`);
  } catch {
    // No `packages/` at all — not a checkout this has anything to say about.
    return [];
  }
}

/**
 * Change path → the docs that have to move with it.
 *
 * Ordered most-specific-first; the first matching rule wins, so
 * `cli.commands.audit.flags.--budget` is a flag obligation, not a command one.
 */
const RULES = [
  {
    match: /^cli\.commands\.[^.]+\.flags\./,
    docs: ["website/packages/cli/commands.md", "packages/cli/README.md"],
    why: "the flag reference lists every flag, and the README's summary is what npm renders",
  },
  {
    match: /^cli\.commands\./,
    docs: [
      "website/packages/cli/commands.md",
      "website/packages/cli.md",
      "packages/cli/README.md",
    ],
    why: "the command index, the package overview, and the README all enumerate commands",
  },
  {
    match: /^cli\.exitCodes$/,
    docs: ["website/packages/cli/commands.md", "website/packages/cli.md"],
    why: "the exit-code table is stated on both, and it is a frozen contract",
  },
  {
    // `(\.|$)` because the two paths this rule covers end differently:
    // `…params.url` has a trailing segment, `…required` does not. Demanding the
    // dot made the `required` branch dead — a change to which parameters a tool
    // requires fell through to the broader rule below and reported the MCP
    // README as needing an update, which only enumerates names and counts.
    match: /^mcp\.tools\.[^.]+\.(params|required)(\.|$)/,
    docs: ["website/packages/mcp/tools.md"],
    why: "every parameter has a bullet with its type, default, and whether it is required",
  },
  {
    match: /^mcp\.tools\./,
    docs: ["website/packages/mcp/tools.md", "packages/mcp/README.md"],
    why: "both state the tool count and enumerate the names",
  },
  {
    match: /^env\./,
    docs: [
      "website/packages/cli/configuration.md",
      "website/packages/mcp/tools.md",
    ],
    why: "configuration is public surface — an undocumented variable is a silently broken setup",
  },
  {
    match: /^packages\.[^.]+\.exports$/,
    docs: ["website/guide/architecture.md"],
    why: "an entry point someone is told to import has to exist",
  },
];

/**
 * Community Agent Skills that move with a surface change.
 *
 * Same shape as RULES, but skill paths are optional files: until
 * `community-skills/` exists, an obligation that names a missing skill is
 * dropped (see `skillExists`), the same way `pageExists` drops missing package
 * pages. Skills are workflows — map capability / package moves, not every flag.
 *
 * Unlike RULES (first match wins), every matching skill rule applies: a
 * `testing` package change must update both the snapshot-tests skill and the
 * surface router.
 */
const SKILL_RULES = [
  {
    match: /^cli\.commands\.(click|type|focus|interact)(\.|$)/,
    skills: ["community-skills/a11y-act-loop/SKILL.md"],
    why: "the act-loop skill walks role+name click/type/focus and --session",
  },
  {
    match: /^cli\.commands\.(snapshot|diff)(\.|$)/,
    skills: ["community-skills/gate-ci-a11y/SKILL.md"],
    why: "the CI-gate skill owns snapshot → diff and baselines",
  },
  {
    match:
      /^cli\.commands\.(audit|inspect|tree|outline|tabs|list|install|login)(\.|$)/,
    skills: ["community-skills/audit-a-page/SKILL.md"],
    why: "the audit-a-page skill walks the CLI audit and view commands",
  },
  {
    match: /^cli\.(exitCodes|commands\.)/,
    skills: [
      "community-skills/audit-a-page/SKILL.md",
      "community-skills/gate-ci-a11y/SKILL.md",
    ],
    why: "CLI exit codes and command surface feed the audit and CI skills",
  },
  {
    match:
      /^mcp\.tools\.(click_element|type_text|focus_element|checkpoint_tree|diff_tree)(\.|$)/,
    skills: ["community-skills/a11y-act-loop/SKILL.md"],
    why: "the act-loop skill is the MCP checkpoint → act → diff workflow",
  },
  {
    match: /^mcp\.tools\./,
    skills: [
      "community-skills/audit-a-page/SKILL.md",
      "community-skills/wire-up-mcp/SKILL.md",
    ],
    why: "audit/setup skills cite MCP tool names and the smoke sequence",
  },
  {
    match: /^env\.REAL_A11Y_MCP_/,
    skills: ["community-skills/wire-up-mcp/SKILL.md"],
    why: "MCP env vars are the wire-up skill's auth and browser contract",
  },
  {
    match: /^packages\.@real-a11y-dev\/testing(\.|$)/,
    skills: ["community-skills/a11y-snapshot-tests/SKILL.md"],
    why: "the testing skill teaches @real-a11y-dev/testing install and APIs",
  },
  {
    // Subpath entry points too: api.@real-a11y-dev/testing/playwright.attach
    match: /^api\.@real-a11y-dev\/testing(?:\/[^.]+)*(\.|$)/,
    skills: ["community-skills/a11y-snapshot-tests/SKILL.md"],
    why: "exported testing symbols are what the snapshot-tests skill shows",
  },
  {
    match: /^packages\.@real-a11y-dev\/storybook-addon(\.|$)/,
    skills: ["community-skills/a11y-in-storybook/SKILL.md"],
    why: "the Storybook skill is the only consumer workflow for the addon",
  },
  {
    match: /^packages\.@real-a11y-dev\/(react|inspector)(\.|$)/,
    skills: ["community-skills/embed-semantic-navigator/SKILL.md"],
    why: "the embed skill chooses react vs inspector and keeps the panel out of prod",
  },
  {
    match: /^api\.@real-a11y-dev\/(react|inspector)(?:\/[^.]+)*(\.|$)/,
    skills: ["community-skills/embed-semantic-navigator/SKILL.md"],
    why: "exported panel APIs are what the embed skill shows in use",
  },
  {
    match: /^packages\.@real-a11y-dev\/(cli|mcp)(\.|$)/,
    skills: ["community-skills/choose-real-a11y-surface/SKILL.md"],
    why: "the router skill's surface table names the installable packages",
  },
  {
    match:
      /^packages\.@real-a11y-dev\/(testing|react|inspector|storybook-addon)(\.|$)/,
    skills: ["community-skills/choose-real-a11y-surface/SKILL.md"],
    why: "the router skill's surface table names the installable packages",
  },
];

function skillExists(repoRoot, skill) {
  return existsSync(join(repoRoot, skill));
}

/**
 * Pull in every community skill that maps to this change path.
 * No-ops when `community-skills/` is absent (skillExists).
 */
function requireSkills(require_, repoRoot, change) {
  for (const rule of SKILL_RULES) {
    if (!rule.match.test(change.path)) continue;
    for (const skill of rule.skills) {
      if (skillExists(repoRoot, skill)) {
        require_(skill, change.what, rule.why);
      }
    }
  }
}

/** `api.@real-a11y-dev/testing/playwright.attach` → `website/packages/testing.md`. */
function apiPage(path) {
  const specifier = path.slice("api.".length).split(".")[0];
  const short = specifier.replace(/^@real-a11y-dev\//, "").split("/")[0];
  return `website/packages/${short}.md`;
}

/** `@real-a11y-dev/cli` → `website/packages/cli.md`. */
function packagePage(name) {
  const short = name.replace(/^@real-a11y-dev\//, "");
  return `website/packages/${short}.md`;
}

/**
 * Whether a page the two functions above computed is a file at all.
 *
 * They compute `website/packages/<short>.md` for ANY package, and seven packages
 * have such a page. The rest do not — including every package with an `api.`
 * namespace but no page (`audit`, `browser`, `serialize`, `snapshot`), and
 * `validate` and `ui`, which never had one. (Not a complement of the seven: nine
 * of the sixteen are page-less once `example-patterns`, `session-registry` and
 * the extension are counted.) So the computed path was a demand to update a
 * file that has never existed, reported with the same weight as `README.md` on a
 * PR where README really was stale — which is how a report teaches people to
 * skim it.
 *
 * This is not a page-creation nag in disguise. A published package with no page
 * is worth an opinion, but it is one decision for §4's table, not something for
 * every symbol added to `serialize` to re-raise. The one place absence is still
 * reported is the arriving direction below, where creating the page IS the
 * obligation.
 *
 * What it cannot tell apart is a page that MOVED from one that was never
 * written: both are "not a file", so a rename retires the obligation instead of
 * reporting it and the report gets QUIETER, which is the failure this tool
 * exists to stop. One page moving is not cheaply detectable from here, and the
 * reason is the paragraph above — telling `testing.md` renamed from
 * `serialize.md` deliberately absent needs the list of which packages are
 * SUPPOSED to have a page, and writing that list down is the editorial call this
 * function declines to make.
 *
 * The wholesale case is cheap, so it is guarded: if `website/packages/` holds no
 * `.md` at all, every call here returns false at once and the entire `api.` half
 * of the report disappears without a word — the same shape as a sample checker
 * that stops recognising samples and reports a clean run forever. It warns to
 * stderr, which `docs-currency.yml` redirects to a file it prints only on
 * failure, so this is a guard for the local run. That is the right size for it:
 * plumbing a field through `buildReport` and both renderers to reach the PR
 * comment buys nothing for a condition that means someone reorganised
 * `website/packages/` wholesale and will meet it the next time they run
 * `pnpm surface:plan`.
 */
const PACKAGE_PAGES_DIR = "website/packages";
/** `plan` is one-shot, so a module-level latch is enough to warn exactly once. */
let checkedPagesDir = false;

function pageExists(repoRoot, doc) {
  if (!checkedPagesDir) {
    checkedPagesDir = true;
    let pages = [];
    try {
      pages = readdirSync(join(repoRoot, PACKAGE_PAGES_DIR)).filter((f) =>
        f.endsWith(".md"),
      );
    } catch {
      // A missing directory is the empty case, and reads the same.
    }
    if (pages.length === 0) {
      console.warn(
        `\nWarning: no .md pages under ${PACKAGE_PAGES_DIR}/, so every package-page\n` +
          `  obligation below was dropped as "there is no such page". If the pages\n` +
          `  moved, the paths computed here (${PACKAGE_PAGES_DIR}/<name>.md) are\n` +
          `  stale, not satisfied.\n`,
      );
    }
  }
  return existsSync(join(repoRoot, doc));
}

/**
 * Whether `doc` says anything about `name` — "is there still an instruction in
 * here to unwrite?".
 *
 * The SCOPED name, never the short one: `validate` matches `validated` and
 * `validation` across half the prose in the repo, while a page that tells you to
 * install something always writes `@real-a11y-dev/<name>`, because that is the
 * string you type. What that misses is a page naming a package only in prose —
 * `why.md` has "the React, Storybook, CLI, and MCP packages".
 *
 * The trade is deliberate, and narrower than this comment used to claim. What
 * the filter buys is that the direction is never reported as EMPTY: `README.md`
 * and `architecture.md` name every package in full, so an unpublishing always
 * produces obligations and the report never reads "nothing to do". What it does
 * NOT buy is the prose-only page itself — nothing here recovers `why.md`, and "a
 * missed page still gets found" was a non-empty direction mistaken for a
 * complete one. Two different facts. The pages that DO name the package are
 * covered by keeping PUBLISHED_PACKAGE_DOCS generous; the ones that merely allude
 * to it are a known hole. Against that: a page demanded for a name it has never
 * contained is the noise this exists to remove.
 *
 * Read from the WORKING TREE rather than the merge base, deliberately. The
 * obligation is "this file still names a package that is no longer published",
 * so the answer self-clears as the branch does the work instead of nagging about
 * a page already fixed — and it stays true when only some of a file's mentions
 * have been dealt with. A file that isn't there names nothing, which is the
 * right answer for the same reason `pageExists` is.
 */
function namesPackage(repoRoot, doc, name) {
  try {
    return readFileSync(join(repoRoot, doc), "utf8").includes(name);
  } catch {
    return false;
  }
}

/**
 * @param {import("./diff.mjs").Change[]} changes
 * @param {string} repoRoot the checkout to resolve doc paths against — this
 *   reads it, to avoid naming pages that don't exist or never named the package
 * @returns {Map<string, {reasons: Set<string>, why: string}>} doc path → why
 */
export function requiredDocs(changes, repoRoot) {
  const required = new Map();
  const require_ = (doc, reason, why) => {
    if (!required.has(doc)) required.set(doc, { reasons: new Set(), why });
    required.get(doc).reasons.add(reason);
  };

  for (const change of changes) {
    // Community skills are a third consumer of the inventory — apply on every
    // change path before the docs rules' early continues can skip them.
    requireSkills(require_, repoRoot, change);

    // Whether a package is publicly installable is its own, much larger,
    // obligation. Three events change it: a brand-new published package, a
    // private one that is now published, and a published one that is now
    // private. All three draw on the same list, because those pages enumerate
    // what a user can install — but only the two arriving events draw on the
    // WHOLE of it; leaving is filtered to the pages that still name the
    // package and additionally sweeps every `packages/*/README.md`, for the
    // reasons given on PUBLISHED_PACKAGE_DOCS and `packageReadmes`.
    const isNewPackage =
      change.kind === "added" &&
      /^packages\.[^.]+$/.test(change.path) &&
      change.detail === "published";
    const flipped =
      change.kind === "changed" &&
      /^packages\.[^.]+\.private$/.test(change.path);
    const unpublished = flipped && change.detail === "published → private";

    if (isNewPackage || flipped) {
      const name = change.path
        .slice("packages.".length)
        .replace(/\.private$/, "");
      // Unpublishing was reported without a single document to fix, which made
      // the report's own "no page maps to these changes" warning fire on the
      // event most likely to leave instructions that are still there, still
      // look right, and no longer work.
      const why = unpublished
        ? "these still tell a user to install it — including the `ignore` list in .changeset/config.json"
        : "a newly published package lands here";
      const pages = [...PUBLISHED_PACKAGE_DOCS, packagePage(name)];
      // Sibling READMEs join on the way OUT only — see `packageReadmes` for why
      // a newly published package has no business in the other fourteen.
      if (unpublished) pages.push(...packageReadmes(repoRoot));
      for (const doc of pages) {
        // Leaving: only the pages that still name it. `.changeset/config.json`
        // is exempt because it is the one entry where NOT naming the package can
        // itself be the thing to fix — a package dropping out of `linked` may
        // belong in `ignore`, and no search for its name can tell you that.
        if (
          unpublished &&
          doc !== ".changeset/config.json" &&
          !namesPackage(repoRoot, doc, name)
        ) {
          continue;
        }
        require_(doc, change.what, why);
      }
      continue;
    }
    // Any other package-level add/remove has no doc rule of its own.
    if (/^packages\.[^.]+$/.test(change.path)) continue;

    // Every `api.*` obligation is decided HERE, in one place.
    //
    // There was a `RULES` entry for the entry-point case as well, and it could
    // never fire: this branch matched the whole `api.` namespace and `continue`d
    // before `RULES.find` was reached. So it was dead code AND a dropped
    // obligation — a new entry point never pulled in the architecture page the
    // rule existed to name. Splitting one decision across a guard and a table is
    // what let those drift apart, so the table entry is gone rather than
    // resurrected.
    //
    // Two shapes, told apart by whether a dot follows the specifier:
    //   api.@real-a11y-dev/testing            → an entry point
    //   api.@real-a11y-dev/testing.flow       → a symbol within one
    if (/^api\.@real-a11y-dev\//.test(change.path)) {
      // Both shapes touch the package page — it introduces the symbol, or
      // documents that the entry point exists at all. When there is one: four of
      // the packages with an `api.` namespace (`audit`, `browser`, `serialize`,
      // `snapshot`) have no page, and a symbol moving inside one of them is not
      // a reason to invent `website/packages/serialize.md`.
      const page = apiPage(change.path);
      if (pageExists(repoRoot, page)) {
        require_(
          page,
          change.what,
          "the package page is where an exported symbol is introduced and shown in use",
        );
      }

      // An entry point additionally appears in the architecture page, which is
      // where "you can import this, from here" is stated across the workspace.
      // An individual symbol does not: that page lists packages, not exports,
      // and sending someone there for `flow` gives them nothing to change.
      const isEntryPoint = !/^api\.@real-a11y-dev\/[^.]+\./.test(change.path);
      if (isEntryPoint) {
        require_(
          "website/guide/architecture.md",
          change.what,
          "the architecture page lists what each package exposes and from where",
        );
      }
      continue;
    }

    const rule = RULES.find((r) => r.match.test(change.path));
    if (!rule) continue;
    for (const doc of rule.docs) require_(doc, change.what, rule.why);

    // The package's own overview page, but only for a change at CAPABILITY
    // level — a command or tool appearing or disappearing. The overview
    // enumerates what the package can do; it doesn't list flags or parameters,
    // so pulling it in for `--budget` or `settleMs` sends someone to a page
    // with nothing to change on it. An obligation nobody can act on is how a
    // report like this trains people to skim past it.
    const isCapability =
      /^cli\.commands\.[^.]+$/.test(change.path) ||
      /^mcp\.tools\.[^.]+$/.test(change.path);
    if (!isCapability) continue;

    if (change.path.startsWith("cli.")) {
      require_(
        "website/packages/cli.md",
        change.what,
        "the package overview shows the surface at a glance",
      );
    }
    if (change.path.startsWith("mcp.")) {
      require_(
        "website/packages/mcp.md",
        change.what,
        "the package overview shows the surface at a glance",
      );
    }
  }
  return required;
}

/**
 * Which scenarios cover a change path, by id.
 *
 * A scenario covering a whole command covers its flags too — someone running
 * `audit` end to end is exercising `--fail-on` — so a `covers:` entry that is a
 * prefix of the change path counts. The dot guard stops `cli.commands.audit`
 * from appearing to cover `cli.commands.audit-extra`.
 *
 * Twins ride along, but ONLY the ones the manifest can't speak for. A twin that
 * covers this path is already in `direct`, so re-listing it says nothing; a twin
 * that covers other paths is genuinely unrelated to this change and naming it is
 * noise. `twin` is not 1:1 and a broad row makes that concrete: D2 covers six
 * commands and twins both R3 (audit) and R4 (the views), so pulling in every twin
 * reported R3 — the audit exit-code row — for a change to a `tree` flag.
 *
 * What's left is the case worth surfacing: a twin with NO `covers` at all. The
 * extension and docs rows are like this, because the extension is private and
 * prose has no manifest path, so the twin link is the only signal that anything
 * over there is affected.
 *
 * Deprecated rows are reported but marked. `checkScenarios` treats
 * deprecated-only coverage as a coverage GAP, so letting `plan` present a retired
 * row as coverage would have the two halves of the same tool disagree — and would
 * tell an author a change is covered by something nobody runs.
 */
function coveringScenarios(path, scenarios) {
  // SYMMETRIC on purpose, and deliberately different from the predicate the
  // coverage gate uses. Two different questions:
  //
  //   "does this row COVER that capability?"  — gate, `paths.mjs`. Ancestor only.
  //       Exercising `snapshot --md` is not covering `snapshot`, so a row listing
  //       just the flag must not satisfy the gate for the whole command.
  //
  //   "is this row AFFECTED by that change?"  — here. Either direction.
  //       If `mcp.tools.type_text` is removed, a row covering only
  //       `mcp.tools.type_text.params.text` is very much affected — its subject
  //       just disappeared — but an ancestor-only match would report `R??` and
  //       the DEPRECATE obligation would look uncovered.
  //
  // Latent today, because no row uses a leaf-level entry. But `scenarios/README.md`
  // explicitly invites them ("R5 covers `snapshot`'s `--md` specifically"), so the
  // first row that takes that advice would go silently invisible to a
  // capability-level removal — the exact false confidence this all exists to stop.
  const affects = (entry) =>
    entry === path ||
    path.startsWith(`${entry}.`) ||
    entry.startsWith(`${path}.`);

  const covered = (s) => (s.covers ?? []).some(affects);

  const direct = scenarios.filter(covered);
  const ids = new Set(direct.map((s) => s.id));
  const byId = new Map(scenarios.map((s) => [s.id, s]));

  const twins = new Set();
  for (const s of direct) {
    for (const t of s.twin ?? []) {
      if (ids.has(t)) continue;
      const other = byId.get(t);
      // Unknown ids are `checkScenarios`' problem, not this report's.
      if (other && (other.covers ?? []).length === 0) twins.add(t);
    }
  }

  const deprecated = direct
    .filter((s) => s.status !== "Active")
    .map((s) => s.id)
    .sort(byIdOrder);

  return {
    ids: [...ids].sort(byIdOrder),
    twins: [...twins].sort(byIdOrder),
    deprecated,
    active: direct.length - deprecated.length,
  };
}

/**
 * R2 before R10 (a plain string sort puts R10 first), and R before D.
 *
 * R-first is the order the work happens in: the pre-publish row is what gates
 * the release, and the dogfood row can only run once the thing is published. A
 * list that led with D would name the one you can't act on yet.
 */
function byIdOrder(a, b) {
  const suite = (id) => (id[0] === "R" ? 0 : 1);
  return suite(a) - suite(b) || Number(a.slice(1)) - Number(b.slice(1));
}

/**
 * What §4b says to do to the Regression / Dogfood suites.
 *
 * This used to deliberately NOT name scenario IDs: the suites lived in Notion,
 * so nothing in the repo could say which rows asserted the behaviour that moved,
 * and a confident wrong ID is worse than none because it's one nobody re-checks.
 * Naming them is exactly what moving the suites into `scenarios/` bought.
 *
 * `scenarios` stays optional so `plan` still works on a branch cut before the
 * migration, or in a checkout where `scenarios/` is absent — it degrades to the
 * old "check them by hand" wording rather than reporting that nothing is
 * covered, which would read as a coverage gap that isn't there.
 *
 * @param {import("./diff.mjs").Change[]} changes
 * @param {object[]} [scenarios] from `scenarios/load.mjs`
 */
export function scenarioObligations(changes, scenarios) {
  const obligations = [];
  const resolvable = Array.isArray(scenarios) && scenarios.length > 0;

  for (const change of changes) {
    const isCapability =
      /^cli\.commands\.[^.]+$/.test(change.path) ||
      /^mcp\.tools\.[^.]+$/.test(change.path);

    const found = resolvable
      ? coveringScenarios(change.path, scenarios)
      : { ids: [], twins: [], deprecated: [], active: 0 };

    let action;
    let note;

    if (change.kind === "added" && isCapability) {
      action = "ADD";
      // A brand-new capability that something already covers means a scenario
      // was written ahead of the code — worth saying, because the obligation is
      // then to check that row rather than to write one. Keyed on ACTIVE rows:
      // a retired row claiming the capability is not coverage, it is the gap
      // `checkScenarios` is about to fail on.
      note = found.active
        ? "a new capability — and these rows already claim to cover it, so confirm they actually assert the shipped behaviour"
        : found.deprecated.length
          ? "a capability a user can invoke, covered only by Deprecated rows — write a live one"
          : "a capability a user can invoke, with no scenario covering it yet";
    } else if (change.kind === "removed" && isCapability) {
      action = "DEPRECATE";
      note =
        "keep the row — Status: Deprecated, Valid until the last version that had it. Deleting it takes the reason it existed with it";
    } else if (change.kind === "removed") {
      action = "UPDATE";
      note =
        "a scenario step that uses this now describes something that is gone — version-range the step, don't deprecate the scenario";
    } else if (change.kind === "added") {
      action = "UPDATE";
      note =
        "worth a step if a scenario already covers the surface it belongs to";
    } else {
      action = "UPDATE";
      note =
        "any scenario asserting the old behaviour needs its Steps/Expected adjusted, and the transition noted so a run against the previous release still makes sense";
    }

    obligations.push({
      action,
      subject: change.what,
      note,
      ids: found.ids,
      twins: found.twins,
      deprecated: found.deprecated,
      resolvable,
    });
  }
  return obligations;
}
