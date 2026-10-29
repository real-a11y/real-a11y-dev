import type { Finding } from "@real-a11y-dev/audit";

const SEVERITY_ORDER: Record<Finding["severity"], number> = {
  error: 0,
  warning: 1,
};
const MAX_LOCATORS = 8;

/**
 * Render findings as a compact agent-readable report plus a JSON block.
 * Identical findings (same severity/rule/message) are grouped with a count and
 * their per-instance locators, so "17 unlabeled links" is one row, not 17.
 */
export function renderAudit(findings: Finding[]): string {
  const errors = findings.filter((f) => f.severity === "error").length;
  const warnings = findings.length - errors;
  if (findings.length === 0) return "No accessibility issues found.";

  const header = `${findings.length} issue(s) — ${errors} error(s), ${warnings} warning(s):`;

  type Group = {
    severity: Finding["severity"];
    rule: string;
    message: string;
    count: number;
    where: string[];
  };
  const groups = new Map<string, Group>();
  for (const f of findings) {
    const key = `${f.severity}|${f.rule}|${f.message}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        severity: f.severity,
        rule: f.rule,
        message: f.message,
        count: 0,
        where: [],
      };
      groups.set(key, g);
    }
    g.count += 1;
    if (f.locator) {
      g.where.push(f.context ? `${f.locator}  ${f.context}` : f.locator);
    }
  }

  const sorted = [...groups.values()].sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      b.count - a.count,
  );

  const lines: string[] = [];
  for (const g of sorted) {
    const countStr = g.count > 1 ? ` (×${g.count})` : "";
    lines.push(`  [${g.severity}] ${g.rule}: ${g.message}${countStr}`);
    for (const w of g.where.slice(0, MAX_LOCATORS)) lines.push(`      ${w}`);
    if (g.where.length > MAX_LOCATORS) {
      lines.push(`      … +${g.where.length - MAX_LOCATORS} more`);
    }
  }

  // Cap the raw findings array so a page with thousands of issues can't blow
  // the agent's context; the grouped human summary above still covers them all.
  const MAX_JSON_FINDINGS = 200;
  const capped = findings.slice(0, MAX_JSON_FINDINGS);
  const json = JSON.stringify(
    {
      summary: {
        total: findings.length,
        errors,
        warnings,
        ...(findings.length > MAX_JSON_FINDINGS
          ? { findingsTruncatedTo: MAX_JSON_FINDINGS }
          : {}),
      },
      findings: capped,
    },
    null,
    2,
  );
  return `${header}\n${lines.join("\n")}\n\n\`\`\`json\n${json}\n\`\`\``;
}

/**
 * Render a single-extraction snapshot: audit + the tree and outline, all from
 * one read of Chromium's own accessibility tree, so they describe one instant.
 *
 * No tab-order section: that tree carries none, and printing an empty block
 * would read as "nothing on this page is focusable" — a very different claim
 * from "not measured here". `get_tab_order` is the tab sequence.
 */
type ViewSnapshot = {
  findings: Finding[];
  tree: string;
  outline: string;
};
export function renderSnapshot(snap: ViewSnapshot): string {
  const treeNodes = snap.tree.split("\n").filter(Boolean).length;
  return [
    `Single-extraction snapshot — ${treeNodes} tree nodes. All sections below describe the same instant. (Tab order is not part of this tree — call get_tab_order for the keyboard sequence.)`,
    "",
    renderAudit(snap.findings),
    "",
    "## Semantic tree",
    "```",
    snap.tree || "(empty)",
    "```",
    "",
    "## Heading outline",
    "```",
    snap.outline,
    "```",
  ].join("\n");
}
