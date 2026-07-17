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
  parseFailOn,
  parseFormat,
  parseOnly,
  type CommandFn,
} from "../args.js";
import { applyBaseline, loadBaseline } from "../baseline.js";
import { diffArtifacts } from "../diff/page-diff.js";
import { CliError, EXIT, exceedsThreshold } from "../exit.js";

import { writeReport } from "../output.js";
import { colorEnabled } from "../render/color.js";
import {
  renderDiffJson,
  renderDiffMarkdown,
  renderDiffPretty,
} from "../render/diff.js";
import { parseSnapshotArtifact } from "../snapshot-artifact.js";

import { outputOf } from "./common.js";

/** `--ignore-view-line` is repeatable; each value must be a valid RegExp.
 * Built without flags — `g` would make `.test` stateful across lines. */
function parseIgnoreViewLine(
  value: string | boolean | undefined | string[],
): RegExp[] {
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
function parsePositive(
  name: string,
  value: string | boolean | undefined,
): number | undefined {
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

  // --baseline: mark accepted findings on the PR side BEFORE diffing — the
  // suppressed flag rides the finding object into the entries, so a NEW
  // finding the baseline accepts is reported (truth) but never gates (policy).
  if (typeof flags.baseline === "string") {
    const { stale } = applyBaseline(
      pr.pages.map((p) => ({ name: p.name, findings: p.findings })),
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
