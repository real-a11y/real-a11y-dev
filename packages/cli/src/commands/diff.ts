/**
 * `real-a11y diff <base.json> <pr.json>` — the findings-aware diff of two
 * snapshot artifacts. Pure: it reads two JSON files and never touches a
 * browser (so `--help`, `--version`, and this command all stay playwright-free
 * — guaranteed by the per-command lazy import in run.ts).
 *
 * Gate: exit 1 iff NEW findings at/above `--fail-on` (default error).
 * REMOVED/CHANGED never fail — pre-existing debt and drift don't block a PR.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  applyBaseline,
  loadBaseline,
  diffArtifacts,
  noPagesMatched,
  assertFullArtifact,
  carriesStates,
  carriesValues,
  parseSnapshotArtifact,
  type SnapshotArtifact,
} from "@real-a11y-dev/snapshot";

import {
  parseFailOn,
  parseFormat,
  parseOnly,
  type CommandFn,
  type FlagValue,
} from "../args.js";

import { CliError, EXIT, exceedsThreshold } from "../exit.js";

import { writeReport } from "../output.js";
import { colorEnabled } from "../render/color.js";
import {
  renderDiffJson,
  renderDiffMarkdown,
  renderDiffPretty,
} from "../render/diff.js";

import { outputOf } from "./common.js";

/** `--ignore-view-line` is repeatable; each value must be a valid RegExp.
 * Built without flags — `g` would make `.test` stateful across lines. */
function parseIgnoreViewLine(value: FlagValue): RegExp[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? [value]
      : [];
  return raw.map((pattern) => {
    try {
      return new RegExp(pattern);
    } catch {
      throw new CliError(
        `--ignore-view-line expects a valid regular expression — got "${pattern}"`,
      );
    }
  });
}

/** A positive-integer cap flag (--max-lines / --max-pages); undefined = off. */
function parsePositive(name: string, value: FlagValue): number | undefined {
  if (value === undefined) return undefined;
  const raw = String(value).trim();
  const n = Number(raw);
  if (raw === "" || !Number.isInteger(n) || n < 1) {
    throw new CliError(`${name} expects a positive integer — got "${raw}"`);
  }
  return n;
}

function readArtifact(path: string, label: string) {
  const abs = resolve(path);
  let json: string;
  try {
    json = readFileSync(abs, "utf8");
  } catch {
    throw new CliError(
      `${label} snapshot not found: ${abs}`,
      "generate it with: real-a11y snapshot --output <file>",
    );
  }
  return parseSnapshotArtifact(json, `${label} snapshot (${abs})`);
}

/**
 * Why a pair captured two different ways churns, one stderr line per way:
 * field values (`snapshot --values`) and `{…}` states blocks (`--no-states`,
 * or a baseline from before the blocks existed). Either one makes a whole
 * class of tree lines read as changed while the page didn't. Findings are
 * unaffected by both.
 */
function mixedPairWarnings(
  base: SnapshotArtifact,
  pr: SnapshotArtifact,
): string[] {
  const warnings: string[] = [];
  // Field values are an opt-in per capture. Without this, a wall of `= "…"`
  // churn reads as a regression.
  if (carriesValues(base) !== carriesValues(pr)) {
    const which = carriesValues(base) ? "base" : "PR";
    warnings.push(
      `real-a11y: warning: only the ${which} snapshot carries field values ` +
        "(captured with --values), so every filled field reads as a changed " +
        "tree line; capture both sides the same way for a like-for-like diff\n",
    );
  }
  // The states block is on by default, so this mostly fires once: a baseline
  // captured before it existed against a capture with it. A generic kept for
  // its state (a <details> summary) is then a new line nesting its subtree.
  if (carriesStates(base) !== carriesStates(pr)) {
    const which = carriesStates(base) ? "base" : "PR";
    warnings.push(
      `real-a11y: warning: only the ${which} snapshot carries {…} states ` +
        "blocks (one captured before they existed, or with --no-states, has " +
        "none), so every node with a state or description reads as a changed " +
        "tree line, and a generic kept for its state as a new line nesting its " +
        "subtree; capture both sides the same way for a like-for-like diff\n",
    );
  }
  return warnings;
}

export const diffCommand: CommandFn = async (positionals, flags) => {
  if (positionals.length !== 2) {
    throw new CliError(
      `diff takes two snapshot files: <base.json> <pr.json> (got ${positionals.length})`,
      "usage: real-a11y diff base.json pr.json",
    );
  }
  const failOn = parseFailOn(flags["fail-on"], "error");
  const format = parseFormat(flags.format, ["pretty", "json", "md"] as const);
  const output = outputOf(flags);
  const ignoreViewLine = parseIgnoreViewLine(flags["ignore-view-line"]);
  const maxLines = parsePositive("--max-lines", flags["max-lines"]);
  const maxPages = parsePositive("--max-pages", flags["max-pages"]);

  // --only filters what's REPORTED, never what gates: the exit code is
  // computed from the full result either way, so `--only views` in a CI job
  // can't silently disable enforcement. Under `--only findings` the view-axis
  // modifiers (--explain, --max-lines, --ignore-view-line) have nothing left
  // to modify and are uniformly inert — deliberate, so a config default like
  // `defaults: { explain: true }` can't wedge the command.
  const only = parseOnly(flags.only);

  const base = readArtifact(positionals[0], "base");
  const pr = readArtifact(positionals[1], "PR");
  // A snapshot captured with --only carries one axis — diffing it would read
  // the missing axis as everything-new / all-removed. Refuse loudly instead.
  assertFullArtifact(base, `base snapshot (${positionals[0]})`);
  assertFullArtifact(pr, `PR snapshot (${positionals[1]})`);

  // A diff that matches nothing still renders (every page added/removed) and
  // still exits on its NEW findings — it just never compares structure, so
  // --explain has nothing to say.
  //
  // The old advice here was "give both sides the same page NAMES", which is now
  // actively wrong: pages join on identity, so names have no bearing and a user
  // following it would rename everything and match exactly as little. Host and
  // port no longer trip this either. What's left is genuinely two different sets
  // of routes — so the remedy is to check the addresses, not the labels.
  if (noPagesMatched(base, pr)) {
    process.stderr.write(
      "real-a11y: warning: no pages matched between the two snapshots — " +
        "pages join on the URL's path (host and port are ignored), so this means " +
        "the two runs captured different routes; check the `url` of each entry on " +
        "both sides, or set a matching `id` if one side deliberately moved\n",
    );
  }

  // --baseline: mark accepted findings on the PR side BEFORE diffing — the
  // suppressed flag rides the finding object into the entries, so a NEW
  // finding the baseline accepts is reported (truth) but never gates (policy).
  if (typeof flags.baseline === "string") {
    const { stale } = applyBaseline(
      pr.pages.map((p) => ({ id: p.id, name: p.name, findings: p.findings })),
      loadBaseline(flags.baseline),
    );
    if (stale.length > 0) {
      process.stderr.write(
        `real-a11y: warning: ${stale.length} baseline entr${
          stale.length === 1 ? "y no longer matches" : "ies no longer match"
        } — run snapshot --update-baseline to prune\n`,
      );
    }
  }

  const result = diffArtifacts(base, pr, { ignoreViewLine });

  // The mixed-pair warnings explain tree lines, so they're for a report that
  // compares some: not under `--only findings`, and not when no page pair was
  // compared (no page in common, or every common page failed on one side).
  if (only !== "findings" && result.pages.some((p) => p.status === "ok")) {
    for (const warning of mixedPairWarnings(base, pr)) {
      process.stderr.write(warning);
    }
  }

  const explain = flags.explain === true;
  const content =
    format === "json"
      ? renderDiffJson(result, only)
      : format === "md"
        ? renderDiffMarkdown(result, { explain, maxLines, maxPages, only })
        : renderDiffPretty(result, {
            color: output === undefined && colorEnabled(),
            explain,
            maxLines,
            maxPages,
            only,
          });
  writeReport(output, content);

  // Only NEW findings gate — drift, fixes, and baselined findings never fail.
  const newFindings = result.pages.flatMap((p) =>
    p.entries
      .filter((e) => e.kind === "new" && !e.finding.suppressed)
      .map((e) => e.finding),
  );
  return exceedsThreshold(newFindings, failOn) ? EXIT.FINDINGS : EXIT.OK;
};
