// The public-surface tool.
//
//   node scripts/surface/index.mjs extract   write docs/surface.json
//   node scripts/surface/index.mjs check     CI gate — read-only
//
// One model of what the packages expose, extracted from the code itself, so
// every claim made about the surface — in the docs today, in the release test
// scenarios next — is checked against the same answer rather than against a
// separate impression of it.
//
// Only `extract` writes. `check` never fixes, so CI can run it on a read-only
// checkout and a failure always means "the repo is out of date", never "the
// tool changed something under you".

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkDocs } from "./check/docs.mjs";
import { buildManifest, MANIFEST_VERSION, serialize } from "./model.mjs";

const repoRoot = resolve(fileURLToPath(import.meta.url), "../../..");
const manifestPath = resolve(repoRoot, "docs/surface.json");
const MANIFEST_REL = "docs/surface.json";

/** Bare enough to be obvious in CI logs; the detail is in the failure body. */
function die(lines) {
  console.error(`\n${lines.join("\n")}\n`);
  process.exit(1);
}

async function extract() {
  const manifest = await buildManifest(repoRoot);
  await writeFile(manifestPath, serialize(manifest), "utf8");
  console.log(
    `Wrote ${MANIFEST_REL} — ${manifest.cli.commands.length} CLI commands, ` +
      `${manifest.mcp.tools.length} MCP tools, ${manifest.packages.length} packages, ` +
      `${manifest.env.length} env vars.`,
  );
}

async function check() {
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
  const problems = await checkDocs(repoRoot, manifest);
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
      `${manifest.mcp.tools.length} MCP tools, manifest current, docs agree.`,
  );
}

const verb = process.argv[2];
if (verb === "extract") {
  await extract();
} else if (verb === "check") {
  await check();
} else {
  die([
    `usage: node scripts/surface/index.mjs <extract|check>`,
    ``,
    `  extract   rebuild ${MANIFEST_REL} from the packages' source`,
    `  check     fail if the manifest is stale or the docs disagree with it`,
  ]);
}
