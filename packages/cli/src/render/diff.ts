/**
 * Render a findings-aware diff. The default (pretty) leads with what a reviewer
 * cares about — NEW violations — then CHANGED, then FIXED, with the advisory
 * structural view-diff last. The summary line is always last so a
 * scan-from-the-bottom reader finds the outcome.
 */

import type { DiffEntry } from "../diff/findings-diff.js";
import type { DiffResult, PageDiff } from "../diff/page-diff.js";
import type { ViewDiff } from "../diff/views-diff.js";

import { palette } from "./color.js";

const ORDER: Record<DiffEntry["kind"], number> = {
  new: 0,
  changed: 1,
  removed: 2,
  unchanged: 3,
};

function sortEntries(entries: readonly DiffEntry[]): DiffEntry[] {
  return [...entries].sort(
    (a, b) =>
      ORDER[a.kind] - ORDER[b.kind] ||
      (a.finding.severity === b.finding.severity
        ? 0
        : a.finding.severity === "error"
          ? -1
          : 1) ||
      a.finding.rule.localeCompare(b.finding.rule),
  );
}

function viewLine(label: string, view: ViewDiff): string | null {
  if (view.added.length === 0 && view.removed.length === 0) return null;
  return `    ${label}: +${view.added.length} / -${view.removed.length} line(s)`;
}

export interface DiffRenderOptions {
  color: boolean;
}

export function renderDiffPretty(
  result: DiffResult,
  options: DiffRenderOptions,
): string {
  const c = palette(options.color);
  const lines: string[] = [];

  for (const page of result.pages) {
    const shown = sortEntries(page.entries).filter(
      (e) => e.kind !== "unchanged",
    );
    const viewLines = [
      viewLine("tree", page.views.tree),
      viewLine("outline", page.views.outline),
      viewLine("tabs", page.views.tabs),
    ].filter((l): l is string => l !== null);

    if (page.status === "incomparable") {
      lines.push(c.bold(`== ${page.name}`));
      lines.push(
        `  ${c.yellow("incomparable")}: ${page.note ?? "a snapshot errored"}`,
      );
      continue;
    }
    if (shown.length === 0 && viewLines.length === 0) continue;

    lines.push(
      c.bold(
        `== ${page.name}${page.status !== "ok" ? ` (${page.status})` : ""}`,
      ),
    );
    for (const e of shown) {
      const f = e.finding;
      if (e.kind === "new") {
        const tag = f.suppressed
          ? c.dim("+ new [baselined]")
          : f.severity === "error"
            ? c.red("+ new [error]")
            : c.yellow("+ new [warning]");
        lines.push(`  ${tag} ${f.rule}: ${f.message}`);
        if (f.locator)
          lines.push(
            `      ${f.locator}${f.context ? `  ${c.dim(f.context)}` : ""}`,
          );
      } else if (e.kind === "changed") {
        lines.push(
          `  ${c.yellow("~ changed")} ${f.rule}: ${(e.changes ?? []).join("; ")}`,
        );
        if (f.locator) lines.push(`      ${c.dim(f.locator)}`);
      } else if (e.kind === "removed") {
        lines.push(
          `  ${c.dim(`- fixed [${f.severity}]`)} ${f.rule}: ${f.message}`,
        );
      }
    }
    if (viewLines.length) {
      lines.push(c.dim("  structure changed (advisory):"));
      lines.push(...viewLines);
    }
  }

  const { new: n, changed, removed } = result.summary;
  if (lines.length) lines.push("");
  const summary = `${n} new · ${changed} changed · ${removed} fixed`;
  lines.push(c.bold(n > 0 ? c.red(summary) : summary));
  return `${lines.join("\n")}\n`;
}

export function renderDiffJson(result: DiffResult): string {
  const page = (p: PageDiff) => ({
    name: p.name,
    status: p.status,
    ...(p.note ? { note: p.note } : {}),
    new: p.entries.filter((e) => e.kind === "new").map((e) => e.finding),
    changed: p.entries
      .filter((e) => e.kind === "changed")
      .map((e) => ({ finding: e.finding, base: e.base, changes: e.changes })),
    removed: p.entries
      .filter((e) => e.kind === "removed")
      .map((e) => e.finding),
    views: p.views,
  });
  return `${JSON.stringify(
    {
      schemaVersion: 1,
      command: "diff",
      summary: result.summary,
      pages: result.pages.map(page),
    },
    null,
    2,
  )}\n`;
}

export function renderDiffMarkdown(result: DiffResult): string {
  const { new: n, changed, removed } = result.summary;
  const out: string[] = [
    `### Accessibility diff — ${n} new · ${changed} changed · ${removed} fixed`,
    "",
  ];
  for (const page of result.pages) {
    const shown = sortEntries(page.entries).filter(
      (e) => e.kind !== "unchanged",
    );
    if (page.status === "incomparable") {
      out.push(
        `#### ${page.name}`,
        "",
        `⚠️ incomparable — ${page.note ?? "a snapshot errored"}`,
        "",
      );
      continue;
    }
    if (shown.length === 0) continue;
    out.push(`#### ${page.name}`, "");
    for (const e of shown) {
      const f = e.finding;
      if (e.kind === "new")
        out.push(
          f.suppressed
            ? `- ⚪ **new (baselined)** \`${f.rule}\`: ${f.message}`
            : `- ❌ **new** \`${f.rule}\`: ${f.message}`,
        );
      else if (e.kind === "changed")
        out.push(
          `- 🔁 **changed** \`${f.rule}\`: ${(e.changes ?? []).join("; ")}`,
        );
      else if (e.kind === "removed")
        out.push(`- ✅ **fixed** \`${f.rule}\`: ${f.message}`);
    }
    out.push("");
  }
  if (n === 0 && changed === 0 && removed === 0) {
    out.push("No accessibility finding changes.", "");
  }
  return `${out.join("\n")}`;
}
