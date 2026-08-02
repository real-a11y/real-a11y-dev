// Assert the docs' claims about the public surface match the manifest.
//
// Prose rots silently: nothing fails when a sentence becomes false. Three
// separate claims went stale here before this existed — the MCP docs said
// "Seventeen tools" after three more shipped, the CLI reference said nine
// commands after the act verbs landed, and a manual test scenario named a
// `get_native_tree` tool that never existed at all.
//
// This is the check `scripts/check-surface-counts.mjs` used to be, reading the
// manifest instead of pattern-matching the source. Same assertions, one less
// place to be wrong: the counts and names now come from the same extraction
// every other consumer reads, so the docs and the scenarios can't be checked
// against two different ideas of what shipped.
//
// It deliberately does NOT check prose *meaning* — only counts and names, the
// part with a single mechanical source of truth.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { withoutGeneratedClaims } from "../render/regions.mjs";

/**
 * The docs spell counts as words, so a number has to become one to compare.
 *
 * Composed rather than tabulated. A hand-written list is exactly the failure
 * this whole check exists to prevent — it works until the surface outgrows it,
 * then reports `write "undefined tools"` and can never pass again. Past ninety-
 * nine a numeral reads better than prose anyway, so that is what it returns.
 */
const ONES = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];
const TENS = [
  "",
  "",
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "sixty",
  "seventy",
  "eighty",
  "ninety",
];

function numberWord(n) {
  if (n < 20) return ONES[n];
  if (n < 100) {
    const tens = TENS[Math.floor(n / 10)];
    const ones = n % 10;
    return ones ? `${tens}-${ONES[ones]}` : tens;
  }
  return String(n);
}

/** Every spelling a doc could legitimately use, plus bare numerals. */
const COUNT_ALTERNATION = [
  ...new Set(Array.from({ length: 100 }, (_, i) => numberWord(i))),
]
  .sort((a, b) => b.length - a.length) // longest first: "twenty-one" before "twenty"
  .join("|");

/**
 * Subset claims, which are not the total and must not be checked against it.
 *
 * `website/packages/mcp/tools.md` says "All three tools share the targeting
 * parameters" about the act group — true, and unrelated to how many tools the
 * server exposes. English marks a reference like that with a determiner, so
 * that is the discriminator. Kept deliberately tight: a bare "the" is too
 * common to exempt safely.
 */
const SUBSET_DETERMINER = /(?:all|these|those|both|other|remaining)\s+$/i;

/**
 * Check every documented count against reality.
 *
 * Scans ALL "<number> <noun>" phrases rather than the first. Checking only the
 * first made the result depend on where in the file the sentence sat: a stale
 * duplicate further down was never examined, and an incidental phrase that
 * happened to come earlier would have been compared against the total.
 *
 * Matched case-insensitively because the same claim is written "Twenty tools"
 * mid-sentence in one file and "**twenty tools**" in another.
 */
function checkCount(fail, file, text, noun, actual) {
  const expected = numberWord(actual);
  const claim = new RegExp(
    `\\b(${COUNT_ALTERNATION}|\\d+)\\s+${noun}\\b`,
    "gi",
  );

  const claims = [...text.matchAll(claim)].filter(
    (m) =>
      !SUBSET_DETERMINER.test(text.slice(Math.max(0, m.index - 24), m.index)),
  );

  if (claims.length === 0) {
    fail(
      file,
      `states no "<number> ${noun}" count — expected "${expected} ${noun}"`,
    );
    return;
  }

  // Every total-shaped claim has to agree; one stale copy left behind in a
  // later paragraph is exactly as wrong as the headline being stale.
  for (const found of claims) {
    if (found[1].toLowerCase() !== expected) {
      fail(
        file,
        `says "${found[0]}" but the code ships ${actual} — write "${expected} ${noun}"`,
      );
    }
  }
}

/**
 * Every name must be documented — as a *command or tool*, not as a word.
 *
 * A bare substring test is exact enough for MCP tools, whose names carry an
 * underscore, but useless for CLI commands: they are ordinary English words.
 * With every code span, heading and table stripped from the command reference,
 * all fourteen of `install audit inspect tree outline tabs list interact click
 * type focus login snapshot diff` still appear in the running prose — so the
 * check passed whether or not the command was documented at all.
 *
 * So a name counts only where it reads as an invocation: opening a code span
 * (`` `list` ``, `` `list <category> <url>` ``) or following the binary
 * (`real-a11y list image <url>`). Incidental prose — "list every element", "the
 * semantic tree" — no longer satisfies it.
 */
function documentedAs(text, name, bin) {
  // `\bname` would still match prose; requiring a backtick or the binary in
  // front is what makes this structural rather than lexical.
  return new RegExp(`(?:\`|${bin} )${name}(?![\\w-])`).test(text);
}

function checkNames(fail, file, text, kind, names, bin) {
  const missing = names.filter((n) => !documentedAs(text, n, bin));
  if (missing.length) {
    fail(file, `never documents ${kind}: ${missing.join(", ")}`);
  }
}

/**
 * Names the docs mention that the code no longer ships. This is the
 * `get_native_tree` case — a plausible-looking name nothing implements, which
 * a count check alone would never notice.
 */
function checkNoGhosts(fail, file, text, kind, shipped, pattern) {
  const ghosts = [
    ...new Set([...text.matchAll(pattern)].map((m) => m[1])),
  ].filter((n) => !shipped.includes(n));
  if (ghosts.length) {
    fail(file, `documents ${kind} the code doesn't ship: ${ghosts.join(", ")}`);
  }
}

/**
 * @param {string} repoRoot
 * @param {object} manifest
 * @returns {Promise<{where: string, message: string}[]>}
 */
export async function checkDocs(repoRoot, manifest) {
  const problems = [];
  const fail = (where, message) => problems.push({ where, message });
  const read = (p) => readFile(resolve(repoRoot, p), "utf8");

  const { bin } = manifest.cli;
  const commands = manifest.cli.commands.map((c) => c.name);
  const tools = manifest.mcp.tools.map((t) => t.name);

  // ---- CLI -----------------------------------------------------------------
  //
  // Without the generated "not published yet" notice: it opens a code span with
  // each unreleased command name, which is exactly the shape `documentedAs`
  // accepts as proof of documentation. A new command would otherwise document
  // itself by being listed as unavailable. See ../render/regions.mjs.
  const cliRef = withoutGeneratedClaims(
    await read("website/packages/cli/commands.md"),
  );
  checkCount(
    fail,
    "website/packages/cli/commands.md",
    cliRef,
    "commands",
    commands.length,
  );
  checkNames(
    fail,
    "website/packages/cli/commands.md",
    cliRef,
    "command",
    commands,
    bin,
  );

  const cliReadme = await read("packages/cli/README.md");
  checkNames(
    fail,
    "packages/cli/README.md",
    cliReadme,
    "command",
    commands,
    bin,
  );

  // ---- MCP -----------------------------------------------------------------
  const mcpReadme = await read("packages/mcp/README.md");
  checkCount(fail, "packages/mcp/README.md", mcpReadme, "tools", tools.length);
  checkNames(fail, "packages/mcp/README.md", mcpReadme, "tool", tools, bin);

  // Stripped for the same reason as the CLI reference, and a no-op until an
  // `mcp-unreleased` region exists — wrapping it now so the follow-up cannot
  // reopen the self-documenting hole by missing a call site.
  const mcpRef = withoutGeneratedClaims(
    await read("website/packages/mcp/tools.md"),
  );
  checkCount(
    fail,
    "website/packages/mcp/tools.md",
    mcpRef,
    "tools",
    tools.length,
  );
  checkNames(fail, "website/packages/mcp/tools.md", mcpRef, "tool", tools, bin);
  // Tool names are distinctive enough to spot in prose; command names are
  // ordinary English words ("list", "type", "focus") and would false-positive.
  checkNoGhosts(
    fail,
    "website/packages/mcp/tools.md",
    mcpRef,
    "tools",
    tools,
    /`([a-z]+_[a-z_]+)`/g,
  );
  checkNoGhosts(
    fail,
    "packages/mcp/README.md",
    mcpReadme,
    "tools",
    tools,
    /`([a-z]+_[a-z_]+)`/g,
  );

  return problems;
}
