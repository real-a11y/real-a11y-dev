// Assert the docs' claims about the public surface match the code.
//
// Prose rots silently: nothing fails when a sentence becomes false. Three
// separate claims went stale here before this existed — the MCP docs said
// "Seventeen tools" after three more shipped, the CLI reference said nine
// commands after the act verbs landed, and a manual test scenario named a
// `get_native_tree` tool that never existed at all.
//
// None of that needed a browser, a network call, or an external service to
// catch: the command table and the tool registrations are right there in the
// source. So this derives both lists from the code and checks that every place
// which states a count, or enumerates the names, agrees.
//
// It deliberately does NOT try to check prose *meaning* — only counts and
// names, the part with a single mechanical source of truth. Wired into
// `pnpm verify` via `pnpm surface:check`.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(import.meta.url), "../..");
const read = (p) => readFile(resolve(repoRoot, p), "utf8");

/** The docs spell counts as words, so a number has to become one to compare. */
const NUMBER_WORDS = [
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
  "twenty",
  "twenty-one",
  "twenty-two",
  "twenty-three",
  "twenty-four",
  "twenty-five",
];

const problems = [];
const fail = (where, message) => problems.push({ where, message });

/**
 * The CLI's shipped commands, from the `COMMANDS` table that `parseArgs`
 * actually dispatches on — not from a list anyone maintains by hand.
 */
async function cliCommands() {
  const src = await read("packages/cli/src/args.ts");
  const table = /export const COMMANDS[^=]*=\s*\{(.*?)\n\};/s.exec(src);
  if (!table)
    throw new Error("could not locate COMMANDS in packages/cli/src/args.ts");
  return [...table[1].matchAll(/^ {2}([a-z][a-z-]*): \{/gm)].map((m) => m[1]);
}

/** The MCP server's tools, from the `registerTool` calls themselves. */
async function mcpTools() {
  const src = await read("packages/mcp/src/server.ts");
  return [...src.matchAll(/server\.registerTool\(\s*"([a-z_]+)"/g)].map(
    (m) => m[1],
  );
}

/**
 * Check a documented count word against reality.
 *
 * Matched case-insensitively because the same claim is written "Twenty tools"
 * mid-sentence in one file and "**twenty tools**" in another.
 */
function checkCount(file, text, noun, actual) {
  const expected = NUMBER_WORDS[actual];
  const claim = new RegExp(`\\b(${NUMBER_WORDS.join("|")})\\s+${noun}\\b`, "i");
  const found = claim.exec(text);
  if (!found) {
    fail(
      file,
      `states no "<number> ${noun}" count — expected "${expected} ${noun}"`,
    );
    return;
  }
  if (found[1].toLowerCase() !== expected) {
    fail(
      file,
      `says "${found[0]}" but the code ships ${actual} — write "${expected} ${noun}"`,
    );
  }
}

/** Every name must appear somewhere in the doc that claims to enumerate them. */
function checkNames(file, text, kind, names) {
  const missing = names.filter((n) => !text.includes(n));
  if (missing.length) {
    fail(file, `never mentions ${kind}: ${missing.join(", ")}`);
  }
}

/**
 * Names the docs mention that the code no longer ships. This is the
 * `get_native_tree` case — a plausible-looking name nothing implements, which
 * a count check alone would never notice.
 */
function checkNoGhosts(file, text, kind, shipped, pattern) {
  const ghosts = [
    ...new Set([...text.matchAll(pattern)].map((m) => m[1])),
  ].filter((n) => !shipped.includes(n));
  if (ghosts.length) {
    fail(file, `documents ${kind} the code doesn't ship: ${ghosts.join(", ")}`);
  }
}

const commands = await cliCommands();
const tools = await mcpTools();

// ---- CLI -------------------------------------------------------------------
const cliRef = await read("website/packages/cli/commands.md");
checkCount(
  "website/packages/cli/commands.md",
  cliRef,
  "commands",
  commands.length,
);
checkNames("website/packages/cli/commands.md", cliRef, "command", commands);

const cliReadme = await read("packages/cli/README.md");
checkNames("packages/cli/README.md", cliReadme, "command", commands);

// ---- MCP -------------------------------------------------------------------
const mcpReadme = await read("packages/mcp/README.md");
checkCount("packages/mcp/README.md", mcpReadme, "tools", tools.length);
checkNames("packages/mcp/README.md", mcpReadme, "tool", tools);

const mcpRef = await read("website/packages/mcp/tools.md");
checkCount("website/packages/mcp/tools.md", mcpRef, "tools", tools.length);
checkNames("website/packages/mcp/tools.md", mcpRef, "tool", tools);
// Tool names are distinctive enough to spot in prose; command names are
// ordinary English words ("list", "type", "focus") and would false-positive.
checkNoGhosts(
  "website/packages/mcp/tools.md",
  mcpRef,
  "tools",
  tools,
  /`([a-z]+_[a-z_]+)`/g,
);
checkNoGhosts(
  "packages/mcp/README.md",
  mcpReadme,
  "tools",
  tools,
  /`([a-z]+_[a-z_]+)`/g,
);

// ---- report ----------------------------------------------------------------
if (problems.length) {
  console.error(
    `\nThe docs disagree with the code about the public surface.\n` +
      `Code ships ${commands.length} CLI commands and ${tools.length} MCP tools.\n`,
  );
  for (const { where, message } of problems) {
    console.error(`  ${where}\n    ${message}\n`);
  }
  console.error(
    "These are objective facts with one source of truth — the docs are what a\n" +
      "user trusts before installing, so they have to move with the code.\n" +
      "Test scenarios that cross-check these counts depend on it too.\n",
  );
  process.exit(1);
}

console.log(
  `Surface check OK — ${commands.length} CLI commands, ${tools.length} MCP tools, docs agree.`,
);
