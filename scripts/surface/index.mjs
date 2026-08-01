// The public-surface tool.
//
//   node scripts/surface/index.mjs extract      write docs/surface.json
//   node scripts/surface/index.mjs check        CI gate — read-only
//   node scripts/surface/index.mjs check-built  the slug function vs the built site
//   node scripts/surface/index.mjs plan         what this branch obliges you to update
//   node scripts/surface/index.mjs scenarios    the release suites + coverage matrix
//
// One model of what the packages expose, extracted from the code itself, so
// every claim made about the surface — in the docs, and in the release test
// scenarios under `scenarios/` — is checked against the same answer rather than
// against a separate impression of it.
//
// Only `extract` writes. `check` never fixes, so CI can run it on a read-only
// checkout and a failure always means "the repo is out of date", never "the
// tool changed something under you".

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Only the `plan` half is imported statically. Everything under `check/` and
// `model.mjs` is loaded on demand inside the verb that needs it, because ESM
// resolves a module's ENTIRE static import graph before running a line of it:
// a top-level `import` of `check/schema.mjs` (which imports `ajv`) made
// `node scripts/surface/index.mjs plan` fail with ERR_MODULE_NOT_FOUND in any
// checkout without `node_modules` — including, precisely, the CI job that runs
// `plan` and deliberately skips the install.
//
// So the rule is: `plan` must reach nothing outside node core and `git`. The
// `plan/*` modules honor that, and are safe at the top level.
import { diffManifests } from "./plan/diff.mjs";
import { changedFiles, manifestAt, mergeBase, refExists } from "./plan/git.mjs";
import { buildReport, renderMarkdown, renderText } from "./plan/report.mjs";
import { nextVersions } from "./plan/versions.mjs";
// Safe at the top level for the same reason: `scenarios/load.mjs` reads files
// with node core only. It is deliberately not YAML-parsed — `plan` is its main
// consumer and runs with no `node_modules`, so a parser dependency here would
// reintroduce exactly the ERR_MODULE_NOT_FOUND described above.
import { loadScenarios } from "./scenarios/load.mjs";

const repoRoot = resolve(fileURLToPath(import.meta.url), "../../..");
const manifestPath = resolve(repoRoot, "docs/surface.json");
const MANIFEST_REL = "docs/surface.json";

/** Bare enough to be obvious in CI logs; the detail is in the failure body. */
function die(lines) {
  console.error(`\n${lines.join("\n")}\n`);
  process.exit(1);
}

async function extract() {
  const { buildManifest, serialize } = await import("./model.mjs");
  const manifest = await buildManifest(repoRoot);
  await writeFile(manifestPath, serialize(manifest), "utf8");
  console.log(
    `Wrote ${MANIFEST_REL} — ${manifest.cli.commands.length} CLI commands, ` +
      `${manifest.mcp.tools.length} MCP tools, ${manifest.packages.length} packages, ` +
      `${manifest.env.length} env vars.`,
  );
}

async function check() {
  const [
    { buildManifest, MANIFEST_VERSION, serialize },
    { checkAnchors, checkDuplicateAnchors },
    { checkCoverage, checkEnvDocumented },
    { checkDocs },
    { checkSamples, checkToolExamples },
    { validateAgainstSchema },
    { checkScenarios },
    { checkPlanSentinel },
    { checkDrift },
  ] = await Promise.all([
    import("./model.mjs"),
    import("./check/anchors.mjs"),
    import("./check/coverage.mjs"),
    import("./check/docs.mjs"),
    import("./check/samples.mjs"),
    import("./check/schema.mjs"),
    import("./scenarios/check.mjs"),
    import("./check/sentinel.mjs"),
    import("./render/index.mjs"),
  ]);

  const manifest = await buildManifest(repoRoot);
  const current = serialize(manifest);

  // 1. Is the committed manifest current? Everything downstream reads it, so a
  //    stale one would let the other checks pass against yesterday's surface.
  let committed;
  try {
    committed = await readFile(manifestPath, "utf8");
  } catch {
    die([`${MANIFEST_REL} is missing.`, ``, `  pnpm surface:extract`]);
  }

  if (committed !== current) {
    let hint =
      "The public surface changed but the manifest wasn't regenerated.";
    try {
      if (JSON.parse(committed).manifestVersion !== MANIFEST_VERSION) {
        hint = `The manifest is at an older layout (v${JSON.parse(committed).manifestVersion} → v${MANIFEST_VERSION}).`;
      }
    } catch {
      hint = `${MANIFEST_REL} isn't valid JSON.`;
    }
    die([
      `${MANIFEST_REL} is out of date.`,
      ``,
      `  ${hint}`,
      `  Regenerate it and commit the result — its diff is how a reviewer sees`,
      `  what moved in the public surface:`,
      ``,
      `    pnpm surface:extract`,
    ]);
  }

  // 2. Do the docs agree with it?
  const samples = await checkSamples(repoRoot, manifest);
  const [docs, coverage, env, examples, anchors, duplicates] =
    await Promise.all([
      checkDocs(repoRoot, manifest),
      checkCoverage(repoRoot, manifest),
      checkEnvDocumented(repoRoot, manifest),
      checkToolExamples(repoRoot, manifest, validateAgainstSchema),
      checkAnchors(repoRoot),
      checkDuplicateAnchors(repoRoot),
    ]);

  // A sample checker that stops recognising samples reports a clean run
  // forever. Zero validated invocations means the tokenizer broke, not that
  // the docs got shorter.
  if (samples.checked === 0) {
    die([
      "The sample check validated no CLI invocations at all.",
      "",
      "  The docs contain `real-a11y …` examples, so this means the scanner",
      "  stopped recognising them — not that there is nothing to check.",
    ]);
  }

  // 3. Do the release test scenarios agree with it?
  //
  //    Same gate, same run, deliberately: a PR that renames a tool has to move
  //    the scenario naming it in the same commit, or the suite silently claims
  //    coverage of something that no longer exists.
  const { scenarios: loaded, problems: scenarioLoadProblems } =
    await loadScenarios(repoRoot);
  const scenarioProblems = [
    ...scenarioLoadProblems.map((message) => ({
      where: "scenarios/",
      message,
    })),
    ...(scenarioLoadProblems.length ? [] : checkScenarios(loaded, manifest)),
  ];

  const problems = [
    ...docs,
    ...samples.problems,
    ...examples,
    ...coverage,
    ...env,
    ...anchors,
    ...duplicates,
    ...scenarioProblems,
    ...(await checkPlanSentinel(repoRoot)),
    // Read-only, and shares its computation with `apply` (D4) so the two can
    // never disagree about what "current" means.
    ...(await checkDrift(repoRoot, manifest)),
  ];

  if (problems.length) {
    console.error(
      `\nThe docs disagree with the code about the public surface.\n` +
        `Code ships ${manifest.cli.commands.length} CLI commands and ` +
        `${manifest.mcp.tools.length} MCP tools.\n`,
    );
    for (const { where, message } of problems) {
      console.error(`  ${where}\n    ${message}\n`);
    }
    die([
      "These are objective facts with one source of truth — the docs are what a",
      "user trusts before installing, so they have to move with the code.",
      "Test scenarios that cross-check these counts depend on it too.",
    ]);
  }

  console.log(
    `Surface check OK — ${manifest.cli.commands.length} CLI commands, ` +
      `${manifest.mcp.tools.length} MCP tools, manifest current, docs agree.\n` +
      `  ${samples.checked} documented CLI invocations parse, ` +
      `every flag and tool parameter is documented, and every #anchor resolves.\n` +
      `  ${loaded.length} release test scenarios parse, every \`covers\` path is real, ` +
      `and every\n  shipped capability has one.`,
  );
}

/**
 * `apply` — the only verb that writes (D4).
 *
 * Never runs in CI. `check` reports the same drift and fixes nothing, so a
 * read-only checkout can always tell you what is stale without being able to
 * quietly make it not-stale.
 */
async function apply() {
  const [{ buildManifest }, { applyAll }] = await Promise.all([
    import("./model.mjs"),
    import("./render/index.mjs"),
  ]);

  const manifest = await buildManifest(repoRoot);
  const result = await applyAll(repoRoot, manifest);

  if (result.problems.length) {
    console.error(`\nCan't rebuild the managed regions.\n`);
    for (const { where, message } of result.problems) {
      console.error(`  ${where}\n    ${message}\n`);
    }
    die([
      "Nothing was written — a partial apply is worse than none, because the",
      "regions it did reach would look current while the rest silently didn't.",
    ]);
  }

  if (result.written.length === 0) {
    console.log("Managed regions already current — nothing written.");
  } else {
    for (const { path, regions } of result.written) {
      console.log(`Wrote ${path} — ${regions.join(", ")}`);
    }
  }

  // A row the generator invented is a row whose prose nobody has written. Say
  // so loudly here, because `apply` is the moment the author can act on it.
  if (result.added.length) {
    console.log(
      `\n  ${result.added.length} row(s) added as TODO — write their prose:\n` +
        result.added.map((a) => `    ${a}`).join("\n") +
        `\n\n  \`pnpm surface:check\` fails until you do. That is deliberate: the` +
        `\n  generator does not write prose, it only refuses to hide a gap.`,
    );
  }
  if (result.removed.length) {
    console.log(
      `\n  ${result.removed.length} row(s) dropped (the surface is gone):\n` +
        result.removed.map((r) => `    ${r}`).join("\n") +
        `\n\n  Each is a scenario-deprecation signal — see \`pnpm surface:plan\`.`,
    );
  }
}

/**
 * The slug function against the site VitePress actually built.
 *
 * Separate from `check` because it needs `pnpm --filter @real-a11y-dev/website
 * build` to have run; `check` stays a read-only checkout away from any build.
 */
async function checkBuilt() {
  const { checkBuiltAnchors, DIST } = await import("./check/built.mjs");
  const { problems, pages, ids } = await checkBuiltAnchors(repoRoot);

  // No pages means the build is missing or moved — the failure this check is
  // for would pass silently.
  if (pages === 0) {
    die([
      `Found no built pages to compare under ${DIST}.`,
      ``,
      `  This check reads the site VitePress emitted, so build it first:`,
      ``,
      `    pnpm --filter @real-a11y-dev/website build`,
    ]);
  }

  if (problems.length) {
    console.error(
      `\nThe slug function disagrees with the ids VitePress emitted.\n` +
        `Every #anchor the docs check validated was computed with it, so this\n` +
        `means those anchors were checked against the wrong answer.\n`,
    );
    for (const { where, message } of problems) {
      console.error(`  ${where}\n    ${message}\n`);
    }
    die([
      "`slugify` in scripts/surface/check/markdown.mjs mirrors",
      "`@mdit-vue/shared`'s. Re-read the copy VitePress ships",
      "(node_modules/vitepress/dist/node/) and make it match again — a bump can",
      "change a rule under us, which is exactly what this catches.",
    ]);
  }

  console.log(
    `Built-site anchors OK — all ${ids} heading ids VitePress emitted across ` +
      `${pages} pages\n  match what slugify() computes from the source.`,
  );
}

/**
 * What this branch obliges you to update — computed, not remembered.
 *
 * Reads both manifests out of git, so it needs no install and no build: the
 * whole point of committing `docs/surface.json` is that its diff is the answer.
 * Read-only and never fails on findings — it reports obligations, and whether
 * to act on them is the author's call, not a gate's.
 */
async function plan(argv) {
  const flag = (name, fallback) => {
    const i = argv.indexOf(`--${name}`);
    return i === -1 ? fallback : argv[i + 1];
  };
  const base = flag("base", "origin/main");
  const asMarkdown = argv.includes("--format")
    ? flag("format") === "markdown"
    : false;

  // Establish the base before trusting anything derived from it. Both failures
  // below would otherwise surface as "the entire public surface is new" — a
  // confident, wrong, and very plausible-looking report.
  if (!(await refExists(repoRoot, base))) {
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

  const mergeBaseRef = await mergeBase(repoRoot, base);
  if (mergeBaseRef === null) {
    die([
      `\`${base}\` and HEAD have no common ancestor.`,
      ``,
      `  A shallow clone is the usual cause — this needs enough history to find`,
      `  the merge base (actions/checkout with fetch-depth: 0).`,
    ]);
  }

  const [baseManifest, touched, versions, scenarios] = await Promise.all([
    manifestAt(repoRoot, mergeBaseRef),
    changedFiles(repoRoot, mergeBaseRef),
    nextVersions(repoRoot),
    // Malformed scenarios must not break `plan`. `check` is the gate that
    // reports them; here they would only cost the report its ids, and a plan
    // that refuses to run is worse than one that says "check by hand".
    loadScenarios(repoRoot).then(
      (r) => r.scenarios,
      () => [],
    ),
  ]);

  let headManifest;
  try {
    headManifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    die([
      `${MANIFEST_REL} is missing — nothing to plan against.`,
      ``,
      `  pnpm surface:extract`,
    ]);
  }

  const changes = diffManifests(baseManifest, headManifest);
  const report = buildReport(changes, touched, versions, scenarios);
  console.log(asMarkdown ? renderMarkdown(report, base) : renderText(report));
}

/**
 * The release test suites, as a gate and as a coverage report.
 *
 * Folded into `check` as well, so a PR that renames a tool can't leave a
 * scenario pointing at a name that no longer exists — the failure mode the
 * suites had for their whole life in Notion, where a row named a
 * `get_native_tree` tool that was never real and nothing could tell.
 */
async function scenarios(argv) {
  const { checkScenarios, coverageSummary } =
    await import("./scenarios/check.mjs");
  const { scenarios: loaded, problems: loadProblems } =
    await loadScenarios(repoRoot);

  if (loadProblems.length) {
    console.error(`\n${loadProblems.length} scenario file(s) don't parse.\n`);
    for (const p of loadProblems) console.error(`  ${p}`);
    die([
      "The frontmatter reader supports `key: value` and `  - item` only —",
      "see the header of scripts/surface/scenarios/load.mjs for why it is not",
      "YAML. Anything else is an error rather than a guess.",
    ]);
  }

  // Zero scenarios means the directory moved or the reader stopped recognising
  // files — the same class of silent-success failure the sample checker guards.
  if (loaded.length === 0) {
    die([
      "Found no scenarios under scenarios/.",
      ``,
      `  The suites are committed to the repo, so this means the loader stopped`,
      `  finding them — not that there are none to check.`,
    ]);
  }

  // Guarded the same way `check` and `plan` guard the identical read. This verb
  // is the one the README tells a contributor to run right after adding a row,
  // so it is the likeliest place to meet a checkout with no manifest — and a raw
  // ENOENT stack tells them nothing about the one command that fixes it.
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    die([
      `${MANIFEST_REL} is missing or isn't valid JSON — nothing to check against.`,
      ``,
      `  Every \`covers\` path is resolved against it, so there is no useful`,
      `  answer without it:`,
      ``,
      `    pnpm surface:extract`,
    ]);
  }

  const problems = checkScenarios(loaded, manifest);
  const coverage = coverageSummary(loaded, manifest);

  if (argv.includes("--coverage")) {
    for (const row of coverage.rows) {
      const by = row.by.length ? row.by.join(", ") : "— nothing";
      console.log(`  ${row.label.padEnd(34)} ${by}`);
    }
    console.log("");
  }

  if (problems.length) {
    console.error(`\nThe release test suites disagree with the code.\n`);
    for (const { where, message } of problems) {
      console.error(`  ${where}\n    ${message}\n`);
    }
    die([
      "A scenario naming a surface that doesn't exist is worse than a missing",
      "one: it reads as coverage. Run `pnpm surface:plan` to see what moved.",
    ]);
  }

  const active = loaded.filter((s) => s.status === "Active").length;
  const manual = loaded.filter((s) => s.type === "Manual").length;
  console.log(
    `Scenario check OK — ${loaded.length} scenarios (${active} active, ` +
      `${manual} manual), every \`covers\` path exists,\n` +
      `  every twin is reciprocated, and all ${coverage.total} shipped ` +
      `capabilities have an active scenario.`,
  );
}

const verb = process.argv[2];
if (verb === "extract") {
  await extract();
} else if (verb === "check") {
  await check();
} else if (verb === "check-built") {
  await checkBuilt();
} else if (verb === "plan") {
  await plan(process.argv.slice(3));
} else if (verb === "scenarios") {
  await scenarios(process.argv.slice(3));
} else if (verb === "apply") {
  await apply();
} else {
  die([
    `usage: node scripts/surface/index.mjs <extract|check|apply|check-built|plan|scenarios>`,
    ``,
    `  extract      rebuild ${MANIFEST_REL} from the packages' source`,
    `  check        fail if the manifest is stale, the docs disagree with it, or`,
    `               a scenario names a surface that doesn't exist`,
    `  apply        rebuild the managed doc regions in place — the only verb that`,
    `               writes to the docs; never runs in CI`,
    `  check-built  fail if slugify() disagrees with the built site's heading`,
    `               ids (needs the website build)`,
    `  plan         report the docs and test scenarios this branch obliges you`,
    `               to update  [--base <ref>] [--format markdown]`,
    `  scenarios    the release suites on their own, with the coverage matrix`,
    `               [--coverage]`,
  ]);
}
