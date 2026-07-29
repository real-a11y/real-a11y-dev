// Which documents a surface change obliges you to update, and what happens to
// the release test scenarios.
//
// This is the `pr` skill's §4 and §4b tables, encoded. Encoded rather than
// recited because the skill's own framing is that the mapping is the part
// people get wrong: the table is read once, remembered approximately, and the
// page that gets missed is always the same one — `website/index.md`, the home
// page, which is both the most visible and the least obviously "documentation".

/**
 * A new published package is the heaviest obligation in the repo. Straight from
 * the skill's "brand-new published package or product surface" row.
 */
const NEW_PACKAGE_DOCS = [
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
    // A brand-new package is its own, much larger, obligation.
    if (change.kind === "added" && /^packages\.[^.]+$/.test(change.path)) {
      const name = change.path.slice("packages.".length);
      if (change.detail === "published") {
        for (const doc of [...NEW_PACKAGE_DOCS, packagePage(name)]) {
          require_(
            doc,
            change.what,
            "a brand-new published package lands here",
          );
        }
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
 * What §4b says to do to the Regression / Dogfood suites.
 *
 * Deliberately does NOT name existing scenario IDs. The scenarios live in
 * Notion today, so nothing in the repo can say which of them assert the
 * behaviour that moved — claiming otherwise would be worse than saying nothing,
 * because a confident wrong ID is one nobody re-checks. Naming them is what
 * putting the scenarios in the repo buys.
 */
export function scenarioObligations(changes) {
  const obligations = [];

  for (const change of changes) {
    const isCapability =
      /^cli\.commands\.[^.]+$/.test(change.path) ||
      /^mcp\.tools\.[^.]+$/.test(change.path);

    if (change.kind === "added" && isCapability) {
      obligations.push({
        action: "ADD",
        subject: change.what,
        note: "a capability a user can invoke, with no scenario covering it yet",
      });
    } else if (change.kind === "removed" && isCapability) {
      obligations.push({
        action: "DEPRECATE",
        subject: change.what,
        note: "keep the row — Status: Deprecated, Valid until the last version that had it. Deleting it takes the reason it existed with it",
      });
    } else if (change.kind === "removed") {
      obligations.push({
        action: "UPDATE",
        subject: change.what,
        note: "a scenario step that uses this now describes something that is gone — version-range the step, don't deprecate the scenario",
      });
    } else if (change.kind === "added") {
      obligations.push({
        action: "UPDATE",
        subject: change.what,
        note: "worth a step if a scenario already covers the surface it belongs to",
      });
    } else {
      obligations.push({
        action: "UPDATE",
        subject: change.what,
        note: "any scenario asserting the old behaviour needs its Steps/Expected adjusted, and the transition noted so a run against the previous release still makes sense",
      });
    }
  }
  return obligations;
}
