// Every flag and parameter the code ships is documented, and every one the
// docs describe exists.
//
// `check/docs.mjs` already does this for commands and tools — the nouns whose
// absence someone would notice. Flags and parameters are the ones that rot
// unnoticed: a new `--flag` ships with the feature and the reference page keeps
// its old list, and nothing anywhere says so.
//
// Both directions matter and they fail differently. An undocumented flag is
// invisible — nobody can use what they can't find. A documented flag that
// doesn't exist is worse: someone types it and gets an error from a tool they
// were told to trust.

import { withoutGeneratedClaims } from "../render/regions.mjs";

import { docFiles, headings, readDoc } from "./markdown.mjs";

const CLI_REFERENCE = "website/packages/cli/commands.md";
const MCP_REFERENCE = "website/packages/mcp/tools.md";

/**
 * A flag counts as documented when it appears as a code span or in a heading.
 *
 * Not "has its own `### --flag` section". The act commands document `--role`,
 * `--name` and `--nth` inline in their own **Flags:** line, because those are
 * command-specific and a shared section would be the wrong home for them. That
 * is good documentation and a rule demanding a section would call it a defect.
 */
function mentionedFlags(text) {
  const spans = [...text.matchAll(/`([^`\n]*)`/g)].map((m) => m[1]);
  const headingText = headings(text).map((h) => h.text);
  const found = new Set();
  for (const chunk of [...spans, ...headingText]) {
    for (const flag of chunk.match(/--[a-z][a-z0-9-]*/g) ?? []) found.add(flag);
  }
  return found;
}

/**
 * Flags the reference names that no command accepts.
 *
 * Restricted to the CLI reference, and to flags in a code span, because the
 * guides legitimately quote OTHER tools' flags — `pnpm --filter`,
 * `playwright test --update-snapshots`, `npx playwright install-deps`. A
 * repo-wide scan for `--word` reports those as ghosts and is useless.
 *
 * A doc sample that passes a flag to `real-a11y` is already covered, and
 * better, by the parser in `check/samples.mjs`.
 */
function ghostFlags(text, shipped) {
  const spans = [...text.matchAll(/`(--[a-z][a-z0-9-]*)(?=[\s`|,)]|$)/g)].map(
    (m) => m[1],
  );
  return [...new Set(spans)].filter((flag) => !shipped.has(flag));
}

/** `- **`name`** — …` — how the MCP reference introduces a parameter. */
function documentedParams(text) {
  return new Set(
    [...text.matchAll(/^- \*\*`([A-Za-z0-9_]+)`\*\*/gm)].map((m) => m[1]),
  );
}

export async function checkCoverage(repoRoot, manifest) {
  const problems = [];

  // ---- CLI flags -----------------------------------------------------------
  //
  // Scanned WITHOUT the generated "not published yet" notice. That region names
  // unreleased flags in code spans, which `mentionedFlags` would otherwise count
  // as documentation — so a brand-new flag would satisfy this check purely by
  // being listed as not-yet-installable. See `NON_DOCUMENTING` in
  // ../render/regions.mjs.
  const reference = withoutGeneratedClaims(
    await readDoc(repoRoot, CLI_REFERENCE),
  );
  const mentioned = mentionedFlags(reference);
  const shipped = new Set(
    manifest.cli.commands.flatMap((c) => c.flags.map((f) => `--${f.name}`)),
  );

  for (const command of manifest.cli.commands) {
    const undocumented = command.flags
      .map((f) => `--${f.name}`)
      .filter((flag) => !mentioned.has(flag));
    if (undocumented.length) {
      problems.push({
        where: CLI_REFERENCE,
        message: `\`${command.name}\` accepts ${undocumented.join(", ")}, which the reference never mentions`,
      });
    }
  }

  const ghosts = ghostFlags(reference, shipped);
  if (ghosts.length) {
    problems.push({
      where: CLI_REFERENCE,
      message: `documents flags no command accepts: ${ghosts.join(", ")}`,
    });
  }

  // ---- MCP parameters ------------------------------------------------------
  //
  // Page-level, not per-tool: the three act tools share one targeting-parameter
  // list ("All three tools share the targeting parameters"), so attributing
  // bullets to the nearest heading reports `role` as undocumented on all three
  // and as a ghost on whichever section precedes them. Page-level is a weaker
  // claim that is actually true, and it still catches the failure that matters
  // — a parameter renamed in the schema and left alone in the prose.
  //
  // Same strip as the CLI reference. A no-op today: `tools.md` carries six
  // managed regions (#283's tool index) but none of them is in
  // `NON_DOCUMENTING` — they are merged tables with hand-written prose, which
  // is documentation and must keep counting as such.
  //
  // It stops being a no-op the moment an `mcp-unreleased` notice exists.
  // `documentedParams` matches `- **\`name\`** — …`, so a bullet-shaped notice
  // would satisfy it exactly the way the CLI notice satisfied `mentionedFlags`.
  // Wrapping the read now means that follow-up cannot reopen the hole by
  // forgetting a call site; all it has to remember is the id in
  // `NON_DOCUMENTING`.
  const toolsRef = withoutGeneratedClaims(
    await readDoc(repoRoot, MCP_REFERENCE),
  );
  const documented = documentedParams(toolsRef);
  const params = new Set(
    manifest.mcp.tools.flatMap((t) =>
      Object.keys(t.inputSchema?.properties ?? {}),
    ),
  );

  const undocumentedParams = [...params].filter((p) => !documented.has(p));
  if (undocumentedParams.length) {
    problems.push({
      where: MCP_REFERENCE,
      message: `tool parameters with no entry: ${undocumentedParams.sort().join(", ")}`,
    });
  }

  const ghostParams = [...documented].filter((p) => !params.has(p));
  if (ghostParams.length) {
    problems.push({
      where: MCP_REFERENCE,
      message: `documents parameters no tool declares: ${ghostParams.sort().join(", ")}`,
    });
  }

  return problems;
}

/**
 * Environment variables the packages read but nothing documents.
 *
 * Repo-wide, because a variable can legitimately be documented on the guide
 * page for whichever product reads it rather than in one central table.
 */
export async function checkEnvDocumented(repoRoot, manifest) {
  const problems = [];
  let corpus = "";
  for (const file of await docFiles(repoRoot)) {
    corpus += await readDoc(repoRoot, file);
  }
  const undocumented = manifest.env
    .map((e) => e.name)
    .filter((name) => !corpus.includes(name));
  if (undocumented.length) {
    problems.push({
      where: "website/",
      message: `environment variables read by the packages but documented nowhere: ${undocumented.join(", ")}`,
    });
  }
  return problems;
}
