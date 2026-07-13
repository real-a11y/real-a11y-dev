/**
 * Render a findings-aware diff. Leads with what a reviewer cares about — NEW
 * violations — then CHANGED, then FIXED, then the structural view diff.
 *
 * Default output is NEUTRAL: findings + the raw `+`/`-` structural view diff,
 * both facts. The plain-language structural statements ("Heading level
 * changed: h2 → h3") are an interpretive layer — pairing heuristics,
 * cross-view inference — and are opt-in via `explain`, so the default never
 * makes a claim the raw diff can't back up. `--format json` always carries the
 * full data (`views` + `structural`); `explain` only governs human output.
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
  /** Add the plain-language structural statements (interpretive layer). */
  explain?: boolean;
}

export function renderDiffPretty(
  result: DiffResult,
  options: DiffRenderOptions,
): string {
  const c = palette(options.color);
  const explain = options.explain ?? false;
  const lines: string[] = [];
  const anyStructural = result.pages.some((p) => p.structural.length > 0);

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
    const counts = viewCounts(page);
    const hasStructural = page.structural.length > 0;
    // Neutral: findings or a raw view-line change. `explain` additionally
    // surfaces reorder-only pages, whose view diffs are empty (the reorder is
    // only visible via the analysis).
    const show = explain
      ? shown.length > 0 || hasStructural
      : shown.length > 0 || counts !== "";
    if (!show) continue;

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
    if (explain && hasStructural) {
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
    } else if (!explain && counts !== "") {
      // Neutral: the counts are the fact; the +/- lines are in --format json.
      lines.push(c.dim(`  structure changed (advisory): ${counts}`));
    }
  }

  const { new: n, changed, removed } = result.summary;
  if (!explain && anyStructural) {
    lines.push(
      c.dim("Run with --explain for a plain-language structural summary."),
    );
  }
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

/** The per-page raw view diff: a bold heading, then per-view ```diff fences
 * (removed lines first, capped per direction). Rendered INLINE, not inside a
 * <details> — GitHub only inlines the green/red diff colors in notification
 * emails for a fence that isn't nested in raw HTML, and email clients
 * auto-expand <details> anyway. Empty when all views are empty (a reorder-only
 * page has statements but no added/removed lines). */
function mdRawBlock(page: PageDiff): string[] {
  const counts = viewCounts(page);
  if (!counts) return [];
  const out: string[] = [`**Raw view diff — ${counts}**`, ""];
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
    out.push(`_${view}_`, "", `${fence}diff`, ...body, fence, "");
  }
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

export interface DiffMarkdownOptions {
  /** Add the plain-language structural statements (interpretive layer). */
  explain?: boolean;
}

export function renderDiffMarkdown(
  result: DiffResult,
  options: DiffMarkdownOptions = {},
): string {
  const explain = options.explain ?? false;
  const { new: n, changed, removed } = result.summary;
  const noFindings = n === 0 && changed === 0 && removed === 0;
  const anyStructural = result.pages.some((p) => p.structural.length > 0);
  const structuralPages = result.pages.filter(
    (p) => p.structural.length > 0,
  ).length;
  // In `explain` mode the header summarizes the structural drift (which is what
  // an email/notification title shows) so a findings-clean-but-structure-moved
  // diff doesn't read as an all-zero "nothing changed". Neutral output keeps
  // the header findings-only — the raw diff below carries the structural facts.
  const structHeader =
    explain && structuralPages > 0
      ? ` · structure changed on ${structuralPages} page${
          structuralPages === 1 ? "" : "s"
        }`
      : "";
  const out: string[] = [
    `### Accessibility diff — ${n} new · ${changed} changed · ${removed} fixed${structHeader}`,
    "",
  ];
  if (noFindings) {
    out.push(
      explain && structuralPages > 0
        ? "No accessibility finding changes — but the semantic structure moved (advisory, review below)."
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
    const counts = viewCounts(page);
    const hasStructural = page.structural.length > 0;
    const show = explain
      ? shown.length > 0 || hasStructural
      : shown.length > 0 || counts !== "";
    if (!show) continue;
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
    // Explain: statements + the raw block. Neutral: the raw block alone.
    if (explain && hasStructural) out.push(...mdStructural(page));
    else if (!explain && counts !== "") out.push(...mdRawBlock(page));
  }
  if (explain && structuralPages > 0) {
    out.push(
      "_Structural notes are advisory and never fail the check; container/nesting moves are not tracked._",
      "",
    );
  } else if (!explain && anyStructural) {
    out.push(
      "_Run with `--explain` for a plain-language summary of the structural changes._",
      "",
    );
  }
  return `${out.join("\n")}`;
}
