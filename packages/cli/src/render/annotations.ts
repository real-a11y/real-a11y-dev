/**
 * GitHub Actions surfaces: `::error`/`::warning` workflow-command annotations
 * and the `$GITHUB_STEP_SUMMARY` markdown. Auto-on under GITHUB_ACTIONS
 * (opt out with --no-annotate); no-ops everywhere else.
 *
 * Two hard rules:
 * - GROUPED, one annotation per (severity, rule, page): the runner caps
 *   annotations (~10 per type per step) — per-finding emission silently
 *   drops the tail.
 * - ESCAPED: annotation text embeds page-derived strings, and `%0A` in an
 *   aria-label would otherwise forge whole annotations. Escaping is
 *   security-relevant here, not polish.
 *
 * Annotations go to stderr: the runner's log processor scans both streams,
 * and stdout must stay exactly one document in `--format json`.
 */

import { appendFileSync } from "node:fs";

import type { FlagValues } from "../args.js";

import { summarize, type PageReport } from "./json.js";

function escapeData(s: string): string {
  return s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

function escapeProperty(s: string): string {
  return escapeData(s).replace(/:/g, "%3A").replace(/,/g, "%2C");
}

export function shouldAnnotate(flags: FlagValues): boolean {
  return process.env.GITHUB_ACTIONS === "true" && flags["no-annotate"] !== true;
}

export function emitAnnotations(
  pages: readonly PageReport[],
  write: (line: string) => void = (line) => process.stderr.write(line),
): void {
  for (const page of pages) {
    if (page.error) {
      write(
        `::error title=${escapeProperty("real-a11y")}::${escapeData(
          `${page.name} — ${page.error}`,
        )}\n`,
      );
      continue;
    }
    // Keyed by message too: heading-order/landmark-structure emit several
    // distinct templates that co-occur, and "3 × Missing <h1>" for one
    // missing-h1 plus two skipped levels would be a lie. Distinct messages
    // per rule are bounded, so the runner's annotation caps are still safe.
    const groups = new Map<string, typeof page.findings>();
    for (const finding of page.findings) {
      const key = `${finding.severity}|${finding.rule}|${finding.message}`;
      const group = groups.get(key);
      if (group) group.push(finding);
      else groups.set(key, [finding]);
    }
    for (const [key, findings] of groups) {
      const [severity, rule] = key.split("|") as ["error" | "warning", string];
      const locators = findings
        .map((f) => f.locator)
        .filter((l): l is string => Boolean(l))
        .slice(0, 3);
      const suffix = locators.length ? ` (${locators.join(", ")})` : "";
      const message = `${page.name} — ${findings.length} × ${findings[0].message}${suffix}`;
      write(
        `::${severity} title=${escapeProperty(rule)}::${escapeData(message)}\n`,
      );
    }
  }
}

/** Fence sized past the longest backtick run inside — page text can't escape. */
function fencedBlock(content: string): string {
  const longestRun = Math.max(
    0,
    ...[...content.matchAll(/`+/g)].map((m) => m[0].length),
  );
  const fence = "`".repeat(Math.max(4, longestRun + 1));
  return `${fence}\n${content}\n${fence}`;
}

/** Sample locators shown per grouped line in the summary. */
const SUMMARY_LOCATORS = 3;
/** GitHub drops step summaries over 1 MiB — stay far under it. */
const SUMMARY_BUDGET = 60_000;

/**
 * Compact built-in summary for the job summary page: counts + one line per
 * (severity, rule) group with sample locators — same grouping as the
 * annotations, and capped, so a pathological page degrades instead of
 * blowing GitHub's per-step size limit and losing the summary entirely.
 */
export function appendStepSummary(
  command: string,
  pages: readonly PageReport[],
): void {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  const parts: string[] = [`### real-a11y ${command}`, ""];
  for (const page of pages) {
    if (page.error) {
      parts.push(fencedBlock(`${page.name}\nfailed: ${page.error}`), "");
      continue;
    }
    const s = summarize(page.findings);
    const lines = [
      `${page.name} — ${s.total} issue(s): ${s.errors} error(s), ${s.warnings} warning(s)`,
    ];
    const groups = new Map<string, typeof page.findings>();
    for (const finding of page.findings) {
      const key = `${finding.severity}|${finding.rule}|${finding.message}`;
      const group = groups.get(key);
      if (group) group.push(finding);
      else groups.set(key, [finding]);
    }
    for (const [key, findings] of groups) {
      const [severity, rule] = key.split("|");
      const locators = findings
        .map((f) => f.locator)
        .filter((l): l is string => Boolean(l))
        .slice(0, SUMMARY_LOCATORS);
      const suffix = locators.length ? ` — ${locators.join(", ")}` : "";
      lines.push(
        `[${severity}] ${rule}: ${findings.length} × ${findings[0].message}${suffix}`,
      );
    }
    parts.push(fencedBlock(lines.join("\n")), "");
  }
  let body = `${parts.join("\n")}\n`;
  if (body.length > SUMMARY_BUDGET) {
    body = `${body.slice(0, body.lastIndexOf("\n", SUMMARY_BUDGET))}\n\n(truncated — full report in the job log)\n`;
  }
  try {
    appendFileSync(file, body, "utf8");
  } catch {
    // The summary is best-effort — never fail the run over it.
  }
}
