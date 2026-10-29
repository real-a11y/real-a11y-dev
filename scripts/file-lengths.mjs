#!/usr/bin/env node
// Holds each file in `eslint-file-lengths.json` to its ceiling from below.
//
//   node scripts/file-lengths.mjs           fail while a ceiling has slack (part of `pnpm lint`)
//   node scripts/file-lengths.mjs --prune   lower it                       (part of `pnpm lint:prune`)
//
// `eslint.config.mjs` holds each listed file to its ceiling from above, as that
// file's own `max-lines` limit. A suppression can't do that job: `max-lines`
// reports a file once however long it is, so a file grandfathered by count
// could grow without limit. This is the other half, the one ESLint's own
// suppressions get from `--prune-suppressions`. A ceiling above its file's
// length is room to grow back into, so `pnpm lint` fails on one until
// `--prune` lowers it, and the ceilings only go down. An entry whose file is
// gone, or has come within the budget every other file is held to, is
// dropped.
//
// It never raises a ceiling or adds a file. A file over its ceiling is
// ESLint's to report; raising one is a hand edit, and `pnpm pr:risk` grades it
// 🔴 high.

import { readFile, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";

import { FILE_LENGTH_BUDGET, FILE_LENGTH_OPTIONS } from "../eslint.config.mjs";

const root = resolve(fileURLToPath(import.meta.url), "../..");
export const CEILINGS = "eslint-file-lengths.json";

/**
 * Each of `files` that exists and is linted, mapped to its length as
 * `max-lines` counts it. One ESLint run, with only `max-lines` on, set to 0 so
 * that it reports every non-empty file's length in its message.
 */
async function lengths(files) {
  // ESLint reads no patterns at all as the whole working directory.
  if (!files.length) return new Map();
  const eslint = new ESLint({
    cwd: root,
    errorOnUnmatchedPattern: false,
    overrideConfig: {
      rules: { "max-lines": ["error", { ...FILE_LENGTH_OPTIONS, max: 0 }] },
    },
    ruleFilter: ({ ruleId }) => ruleId === "max-lines",
  });
  const found = new Map();
  for (const result of await eslint.lintFiles(files)) {
    // A file named outright but ignored comes back with only a notice saying
    // so: not linted, rather than empty.
    if (result.messages.some((m) => !m.ruleId && /ignored/i.test(m.message))) {
      continue;
    }
    const report = result.messages.find((m) => m.ruleId === "max-lines");
    const length = report ? Number(/\((\d+)\)/.exec(report.message)?.[1]) : 0;
    found.set(relative(root, result.filePath).replaceAll("\\", "/"), length);
  }
  return found;
}

/**
 * The ceilings `--prune` leaves: each lowered to its file's length, and none
 * for a file that is gone or now within `budget`. Never one raised.
 */
export function pruned(ceilings, found, budget) {
  const out = {};
  for (const file of Object.keys(ceilings).sort()) {
    const length = found.get(file);
    if (length === undefined || length <= budget) continue;
    out[file] = Math.min(ceilings[file], length);
  }
  return out;
}

/** One line per ceiling `--prune` would change. */
export function slack(ceilings, found, budget) {
  const after = pruned(ceilings, found, budget);
  return Object.entries(ceilings)
    .filter(([file, ceiling]) => after[file] !== ceiling)
    .map(([file, ceiling]) => {
      if (!found.has(file)) return `${file}: no longer linted`;
      const length = found.get(file);
      return length <= budget
        ? `${file}: ${length} lines, within the budget of ${budget}`
        : `${file}: ceiling ${ceiling}, now ${length} lines`;
    });
}

async function main(prune) {
  const path = resolve(root, CEILINGS);
  const ceilings = JSON.parse(await readFile(path, "utf8"));
  const found = await lengths(Object.keys(ceilings));
  if (prune) {
    const after = pruned(ceilings, found, FILE_LENGTH_BUDGET);
    await writeFile(path, `${JSON.stringify(after, null, 2)}\n`);
    return;
  }
  const problems = slack(ceilings, found, FILE_LENGTH_BUDGET);
  if (!problems.length) return;
  console.error(
    [
      `${CEILINGS} holds file-length ceilings above where their files now are:`,
      ...problems.map((p) => `  ${p}`),
      "",
      "Run `pnpm lint:prune` to lower them, and commit the result.",
    ].join("\n"),
  );
  process.exitCode = 1;
}

// Run as a script, not imported by its test. Windows paths compare without
// case: a shell can report the drive as `c:` while the module URL says `C:`,
// and a mismatch here would skip the check and pass silently.
const self = fileURLToPath(import.meta.url);
const invoked = resolve(process.argv[1] ?? "");
const fold = (p) => (process.platform === "win32" ? p.toLowerCase() : p);
if (fold(invoked) === fold(self)) {
  await main(process.argv.includes("--prune"));
}
