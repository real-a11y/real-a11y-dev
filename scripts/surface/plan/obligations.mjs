// Which documents a surface change obliges you to update, and what happens to
// the release test scenarios.
//
// This is the `pr` skill's §4 and §4b tables, encoded. Encoded rather than
// recited because the skill's own framing is that the mapping is the part
// people get wrong: the table is read once, remembered approximately, and the
// page that gets missed is always the same one — `website/index.md`, the home
// page, which is both the most visible and the least obviously "documentation".

/**
 * Every page that enumerates the published packages. From the skill's
 * "brand-new published package or product surface" row — the heaviest
 * obligation in the repo.
 *
 * The same list applies in BOTH directions. Publishing a package means these
 * pages don't mention something they should; unpublishing one means they tell
 * people to install something they can't. The second is arguably worse, because
 * the instructions are still there and still look right.
 */
const PUBLISHED_PACKAGE_DOCS = [
  "README.md",
  "website/index.md",
  "website/guide/architecture.md",
  "website/guide/getting-started.md",
  "website/guide/why.md",
  ".changeset/config.json",
];

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

/** `@real-a11y-dev/cli` → `website/packages/cli.md`. */
function packagePage(name) {
  const short = name.replace(/^@real-a11y-dev\//, "");
  return `website/packages/${short}.md`;
}

/**
 * @param {import("./diff.mjs").Change[]} changes
 * @returns {Map<string, {reasons: Set<string>, why: string}>} doc path → why
 */
export function requiredDocs(changes) {
  const required = new Map();
  const require_ = (doc, reason, why) => {
    if (!required.has(doc)) required.set(doc, { reasons: new Set(), why });
    required.get(doc).reasons.add(reason);
  };

  for (const change of changes) {
    // Whether a package is publicly installable is its own, much larger,
    // obligation. Three events change it: a brand-new published package, a
    // private one that is now published, and a published one that is now
    // private. All three touch the same pages, because those pages enumerate
    // what a user can install.
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
      for (const doc of [...PUBLISHED_PACKAGE_DOCS, packagePage(name)]) {
        require_(doc, change.what, why);
      }
      continue;
    }
    // Any other package-level add/remove has no doc rule of its own.
    if (/^packages\.[^.]+$/.test(change.path)) continue;

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
 * Twins ride along on purpose. A pre-publish row and its post-publish
 * counterpart assert the same subject at two altitudes, so a change that
 * invalidates one almost always invalidates the other — and the one people
 * forget is whichever suite they aren't currently running.
 */
function coveringScenarios(path, scenarios) {
  const direct = scenarios.filter((s) =>
    (s.covers ?? []).some(
      (entry) => entry === path || path.startsWith(`${entry}.`),
    ),
  );
  const ids = new Set(direct.map((s) => s.id));
  const twins = new Set();
  for (const s of direct) {
    for (const t of s.twin ?? []) if (!ids.has(t)) twins.add(t);
  }
  return {
    ids: [...ids].sort(byIdOrder),
    twins: [...twins].sort(byIdOrder),
    active: direct.filter((s) => s.status === "Active").length,
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
      : { ids: [], twins: [], active: 0 };

    let action;
    let note;

    if (change.kind === "added" && isCapability) {
      action = "ADD";
      // A brand-new capability that something already covers means a scenario
      // was written ahead of the code — worth saying, because the obligation is
      // then to check that row rather than to write one.
      note = found.ids.length
        ? "a new capability — and these rows already claim to cover it, so confirm they actually assert the shipped behaviour"
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
      resolvable,
    });
  }
  return obligations;
}
