/**
 * Render a findings-aware diff. The default (pretty) leads with what a reviewer
 * cares about — NEW violations — then CHANGED, then FIXED, with the advisory
 * structural view-diff last. The summary line is always last so a
 * scan-from-the-bottom reader finds the outcome.
 */

import type { DiffEntry } from "../diff/findings-diff.js";
import type { DiffResult, PageDiff } from "../diff/page-diff.js";

import { palette } from "./color.js";

const ORDER: Record<DiffEntry["kind"], number> = {
  new: 0,
  changed: 1,
  removed: 2,
  unchanged: 3,
};

/** Statements shown per page in pretty/md before "… N more" (json is uncapped). */
const STATEMENT_CAP = 10;
/** Raw lines shown per view per direction inside the collapsed md block. */
const RAW_LINE_CAP = 25;

const VIEW_NAMES = ["tree", "outline", "tabs"] as const;

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

/** `tree +3/-1 · tabs +2/-0` — per-view counts, non-empty views only. */
function viewCounts(page: PageDiff): string {
  return VIEW_NAMES.filter(
    (v) => page.views[v].added.length || page.views[v].removed.length,
  )
    .map(
      (v) =>
        `${v} +${page.views[v].added.length}/-${page.views[v].removed.length}`,
    )
    .join(" · ");
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

    if (page.status === "incomparable") {
      lines.push(c.bold(`== ${page.name}`));
      lines.push(
        `  ${c.yellow("incomparable")}: ${page.note ?? "a snapshot errored"}`,
      );
      continue;
    }
    // structural covers the views by totality (every non-empty view diff
    // yields at least the rollup statement) AND catches reorder-only pages,
    // whose view diffs are empty.
    if (shown.length === 0 && page.structural.length === 0) continue;

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
    if (page.structural.length) {
      const counts = viewCounts(page);
      lines.push(
        c.dim(`  structure changed (advisory):${counts ? ` ${counts}` : ""}`),
      );
      for (const s of page.structural.slice(0, STATEMENT_CAP)) {
        lines.push(c.dim(`    · ${s.message}`));
      }
      if (page.structural.length > STATEMENT_CAP) {
        lines.push(
          c.dim(
            `    · … ${page.structural.length - STATEMENT_CAP} more (see --format json)`,
          ),
        );
      }
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
    structural: p.structural,
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

/** Escape a statement for a markdown bullet. Accessible names are page
 * content — a name containing `</details>`, `**`, or backticks must render
 * literally, never as structure. Backslash-escapes markdown metacharacters
 * and entity-escapes HTML. */
function mdEscape(text: string): string {
  return text
    .replaceAll("\\", "\\\\")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replace(/[`*_[\]#|~]/g, (ch) => `\\${ch}`);
}

/** A ``` fence breaks if the content contains one — use one backtick more
 * than the longest run in the content (min 3). */
function fenceFor(lines: readonly string[]): string {
  let longest = 0;
  for (const line of lines) {
    for (const run of line.match(/`+/g) ?? []) {
      longest = Math.max(longest, run.length);
    }
  }
  return "`".repeat(Math.max(3, longest + 1));
}

/** The per-page collapsed raw block: per-view ```diff fences, removed lines
 * first, capped per direction. Empty string when all views are empty
 * (reorder-only pages have statements but no raw lines). */
function mdRawBlock(page: PageDiff): string[] {
  const counts = viewCounts(page);
  if (!counts) return [];
  const out: string[] = [
    "<details>",
    `<summary>Raw view diff — ${counts}</summary>`,
    "", // GitHub needs a blank line to render markdown inside <details>
  ];
  for (const view of VIEW_NAMES) {
    const { added, removed } = page.views[view];
    if (added.length === 0 && removed.length === 0) continue;
    const removedShown = removed.slice(0, RAW_LINE_CAP);
    const addedShown = added.slice(0, RAW_LINE_CAP);
    const hidden =
      removed.length - removedShown.length + (added.length - addedShown.length);
    const body = [
      ...removedShown.map((l) => `- ${l}`),
      ...addedShown.map((l) => `+ ${l}`),
      ...(hidden > 0 ? [`… ${hidden} more line(s)`] : []),
    ];
    const fence = fenceFor(body);
    out.push(`**${view}**`, "", `${fence}diff`, ...body, fence, "");
  }
  out.push("</details>", "");
  return out;
}

function mdStructural(page: PageDiff): string[] {
  if (page.structural.length === 0) return [];
  const out: string[] = ["**Structure (advisory — never blocks merge):**", ""];
  for (const s of page.structural.slice(0, STATEMENT_CAP)) {
    out.push(`- ${mdEscape(s.message)}`);
  }
  if (page.structural.length > STATEMENT_CAP) {
    out.push(
      `- … ${page.structural.length - STATEMENT_CAP} more — see raw diff below`,
    );
  }
  out.push("");
  out.push(...mdRawBlock(page));
  return out;
}

export function renderDiffMarkdown(result: DiffResult): string {
  const { new: n, changed, removed } = result.summary;
  const out: string[] = [
    `### Accessibility diff — ${n} new · ${changed} changed · ${removed} fixed`,
    "",
  ];
  const structuralPages = result.pages.filter(
    (p) => p.structural.length > 0,
  ).length;
  if (n === 0 && changed === 0 && removed === 0) {
    out.push(
      structuralPages > 0
        ? `No accessibility finding changes. Structural changes on ${structuralPages} page(s) — advisory, review below.`
        : "No accessibility finding changes.",
      "",
    );
  }
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
    if (shown.length === 0 && page.structural.length === 0) continue;
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
    if (shown.length) out.push("");
    out.push(...mdStructural(page));
  }
  if (structuralPages > 0) {
    out.push(
      "_Structural notes are advisory and never fail the check; container/nesting moves are not tracked._",
      "",
    );
  }
  return `${out.join("\n")}`;
}
