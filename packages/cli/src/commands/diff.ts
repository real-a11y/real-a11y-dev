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

import { parseFailOn, parseFormat, type CommandFn } from "../args.js";
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

  const base = readArtifact(positionals[0], "base");
  const pr = readArtifact(positionals[1], "PR");
  const result = diffArtifacts(base, pr);

  const content =
    format === "json"
      ? renderDiffJson(result)
      : format === "md"
        ? renderDiffMarkdown(result)
        : renderDiffPretty(result, {
            color: output === undefined && colorEnabled(),
          });
  writeReport(output, content);

  // Only NEW findings gate — drift and fixes never fail the build.
  const newFindings = result.pages.flatMap((p) =>
    p.entries.filter((e) => e.kind === "new").map((e) => e.finding),
  );
  return exceedsThreshold(newFindings, failOn) ? EXIT.FINDINGS : EXIT.OK;
};
