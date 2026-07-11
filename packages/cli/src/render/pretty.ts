/**
 * The default human report. Contract (also the accessible-output contract):
 * severity always as a text tag, findings grouped by rule+message with
 * locators beneath, and the summary as the LAST line so the `--fail-on`
 * outcome is always findable. ASCII markers only; LF only; deterministic.
 */

import type { FingerprintedFinding } from "../fingerprint.js";

import { palette } from "./color.js";
import { summarizeAll, type PageReport } from "./json.js";

const MAX_LOCATORS = 8;

interface Group {
  severity: "error" | "warning";
  rule: string;
  message: string;
  findings: FingerprintedFinding[];
}

function groupFindings(findings: readonly FingerprintedFinding[]): Group[] {
  const groups = new Map<string, Group>();
  for (const finding of findings) {
    const key = `${finding.severity}|${finding.rule}|${finding.message}`;
    const group = groups.get(key);
    if (group) group.findings.push(finding);
    else {
      groups.set(key, {
        severity: finding.severity,
        rule: finding.rule,
        message: finding.message,
        findings: [finding],
      });
    }
  }
  // Errors before warnings, then larger groups first; ties keep insertion
  // (document) order — Map preserves it, and sort() is stable.
  return [...groups.values()].sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "error" ? -1 : 1;
    return b.findings.length - a.findings.length;
  });
}

export interface PrettyOptions {
  color: boolean;
}

export function renderPretty(
  pages: readonly PageReport[],
  options: PrettyOptions,
): string {
  const c = palette(options.color);
  const lines: string[] = [];
  const multi = pages.length > 1;

  for (const page of pages) {
    if (multi) {
      if (lines.length) lines.push("");
      lines.push(c.bold(`== ${page.name}`));
    }
    if (page.error) {
      lines.push(`  ${c.red("[error]")} page failed: ${page.error}`);
      continue;
    }
    const groups = groupFindings(page.findings);
    if (groups.length === 0 && multi) {
      lines.push(`  ${c.dim("no issues")}`);
      continue;
    }
    for (const group of groups) {
      const tag =
        group.severity === "error" ? c.red("[error]") : c.yellow("[warning]");
      const count =
        group.findings.length > 1 ? ` (×${group.findings.length})` : "";
      lines.push(`  ${tag} ${group.rule}: ${group.message}${count}`);
      const located = group.findings.filter((f) => f.locator);
      for (const finding of located.slice(0, MAX_LOCATORS)) {
        const context = finding.context ? `  ${c.dim(finding.context)}` : "";
        lines.push(`      ${finding.locator}${context}`);
      }
      if (located.length > MAX_LOCATORS) {
        lines.push(c.dim(`      … +${located.length - MAX_LOCATORS} more`));
      }
    }
  }

  const total = summarizeAll(pages);
  if (lines.length) lines.push("");
  if (total.total === 0) {
    lines.push("No accessibility issues found.");
  } else {
    const noun = total.total === 1 ? "issue" : "issues";
    const summary = `${total.total} ${noun} — ${total.errors} error(s), ${total.warnings} warning(s)`;
    lines.push(
      c.bold(total.errors > 0 ? c.red(summary) : c.yellow(summary)),
    );
  }
  return `${lines.join("\n")}\n`;
}
