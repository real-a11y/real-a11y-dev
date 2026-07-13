/**
 * Render a findings-aware diff. Leads with NEW violations, then CHANGED, then
 * FIXED, then the structural view diff.
 *
 * The structural half is a real UNIFIED DIFF (context + order + indentation) —
 * what a reviewer reads to locate a change, like a PR file diff. Neutral by
 * default: findings + that diff, both facts. `--explain` adds the interpretive
 * plain-language statements on top. Full by default; `--max-lines` and
 * `--max-pages` cap the output for CI comments (the full diff still prints to
 * the job log). `--format json` always carries the machine data
 * (`views` + `structural`); the flags only govern human output.
 */

import type { DiffEntry } from "../diff/findings-diff.js";
import type { DiffResult, PageDiff } from "../diff/page-diff.js";
import { hunkHeader } from "../diff/unified-diff.js";

import { palette, type Palette } from "./color.js";

const ORDER: Record<DiffEntry["kind"], number> = {
  new: 0,
  changed: 1,
  removed: 2,
  unchanged: 3,
};

/** Plain-language statements shown per page before "… N more" (json is uncapped). */
const STATEMENT_CAP = 10;

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

function shownEntries(page: PageDiff): DiffEntry[] {
  return sortEntries(page.entries).filter((e) => e.kind !== "unchanged");
}

/** The serialized structure differs (any view has a hunk). */
function hasHunks(page: PageDiff): boolean {
  return VIEW_NAMES.some((v) => page.viewHunks[v].length > 0);
}

/** A page worth showing: a finding change, a structural diff, or incomparable. */
function isChanged(page: PageDiff): boolean {
  return (
    page.status === "incomparable" ||
    shownEntries(page).length > 0 ||
    hasHunks(page)
  );
}

// ── unified diff → capped line blocks ────────────────────────────────────────

interface DiffBlock {
  view: string;
  /** Raw diff-content lines: `@@ … @@` headers and `±text`/` text` lines. */
  lines: string[];
}

/** Flatten a page's per-view hunks into blocks, capping the TOTAL diff-content
 * lines across all views at `maxLines` (Infinity = uncapped). */
function cappedBlocks(
  page: PageDiff,
  maxLines: number,
): { blocks: DiffBlock[]; hidden: number } {
  let budget = maxLines;
  let hidden = 0;
  const blocks: DiffBlock[] = [];
  for (const view of VIEW_NAMES) {
    const hunks = page.viewHunks[view];
    if (hunks.length === 0) continue;
    const content: string[] = [];
    for (const h of hunks) {
      content.push(hunkHeader(h));
      for (const l of h.lines) content.push(`${l.tag}${l.text}`);
    }
    if (budget <= 0) {
      hidden += content.length;
    } else if (content.length > budget) {
      blocks.push({ view, lines: content.slice(0, budget) });
      hidden += content.length - budget;
      budget = 0;
    } else {
      blocks.push({ view, lines: content });
      budget -= content.length;
    }
  }
  return { blocks, hidden };
}

// ── shared helpers ───────────────────────────────────────────────────────────

const plural = (n: number) => (n === 1 ? "" : "s");

/** Wrap page-controlled text in a backtick-safe inline code span. A code span
 * renders its content literally (so `<`, `**`, `</details>` are inert), and
 * sizing the fence past the longest backtick run + padding handles a name that
 * itself contains backticks. */
function codeSpan(text: string): string {
  let longest = 0;
  for (const run of text.match(/`+/g) ?? []) {
    longest = Math.max(longest, run.length);
  }
  const fence = "`".repeat(longest + 1);
  const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}

function pageList(pages: readonly PageDiff[]): string {
  return pages.map((p) => codeSpan(p.name)).join(", ");
}

export interface DiffRenderOptions {
  color: boolean;
  /** Add the plain-language structural statements (interpretive layer). */
  explain?: boolean;
  /** Cap the structural diff to N lines per page (default: unlimited). */
  maxLines?: number;
  /** Detail at most N changed pages (default: unlimited). */
  maxPages?: number;
}

// ── pretty (terminal) ────────────────────────────────────────────────────────

function prettyViewDiff(
  page: PageDiff,
  maxLines: number,
  c: Palette,
): string[] {
  const { blocks, hidden } = cappedBlocks(page, maxLines);
  const out: string[] = [];
  for (const b of blocks) {
    out.push(c.dim(`  ${b.view}`));
    for (const line of b.lines) {
      const head = line[0];
      const colored =
        head === "-"
          ? c.red(line)
          : head === "+"
            ? c.green(line)
            : head === "@"
              ? c.dim(line)
              : line;
      out.push(`  ${colored}`);
    }
  }
  if (hidden > 0) {
    out.push(
      c.dim(
        `  … ${hidden} more diff line${plural(hidden)} (run without --max-lines, or see the job log)`,
      ),
    );
  }
  return out;
}

export function renderDiffPretty(
  result: DiffResult,
  options: DiffRenderOptions,
): string {
  const c = palette(options.color);
  const explain = options.explain ?? false;
  const maxLines = options.maxLines ?? Infinity;
  const maxPages = options.maxPages ?? Infinity;
  const lines: string[] = [];

  const changed = result.pages.filter(isChanged);
  const structPages = result.pages.filter(hasHunks).length;
  const detailed = changed.slice(0, maxPages);
  const overflow = changed.slice(maxPages);

  for (const page of detailed) {
    if (page.status === "incomparable") {
      lines.push(c.bold(`== ${page.name}`));
      lines.push(
        `  ${c.yellow("incomparable")}: ${page.note ?? "a snapshot errored"}`,
      );
      continue;
    }
    lines.push(
      c.bold(
        `== ${page.name}${page.status !== "ok" ? ` (${page.status})` : ""}`,
      ),
    );
    for (const e of shownEntries(page)) {
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
    if (explain && page.structural.length) {
      lines.push(c.dim("  structure changed (advisory):"));
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
    lines.push(...prettyViewDiff(page, maxLines, c));
  }

  if (overflow.length) {
    lines.push(
      c.dim(
        `… and ${overflow.length} more page${plural(overflow.length)} with changes: ${overflow.map((p) => p.name).join(", ")}`,
      ),
    );
  }
  if (!explain && structPages > 0) {
    lines.push(
      c.dim("Run with --explain for a plain-language structural summary."),
    );
  }

  const { new: n, changed: ch, removed } = result.summary;
  if (lines.length) lines.push("");
  const summary = `${n} new · ${ch} changed · ${removed} fixed`;
  lines.push(c.bold(n > 0 ? c.red(summary) : summary));
  return `${lines.join("\n")}\n`;
}

// ── json (machine surface — unchanged by the flags) ──────────────────────────

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
    // Whether the unified diff has any hunk — the "did the structure change"
    // signal for consumers that don't render the hunks (the a11y-diff workflow
    // reads this to decide the comment). `structural` misses a pure TREE
    // reorder (no tree-reorder statement pass); `viewHunks` catches it, so this
    // is the honest per-page changed flag.
    structuralDiff: hasHunks(p),
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

// ── markdown (PR comment) ────────────────────────────────────────────────────

/** Escape a statement for a markdown bullet. Accessible names are page content
 * — a name containing `</details>`, `**`, or backticks must render literally,
 * never as structure. */
function mdEscape(text: string): string {
  return text
    .replaceAll("\\", "\\\\")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replace(/[`*_[\]#|~]/g, (ch) => `\\${ch}`);
}

/** A ``` fence breaks if the content contains one — use one backtick more than
 * the longest run in the content (min 3). */
function fenceFor(lines: readonly string[]): string {
  let longest = 0;
  for (const line of lines) {
    for (const run of line.match(/`+/g) ?? []) {
      longest = Math.max(longest, run.length);
    }
  }
  return "`".repeat(Math.max(3, longest + 1));
}

function mdStatements(page: PageDiff): string[] {
  if (page.structural.length === 0) return [];
  const out: string[] = ["**Structure (advisory — never blocks merge):**", ""];
  for (const s of page.structural.slice(0, STATEMENT_CAP)) {
    out.push(`- ${mdEscape(s.message)}`);
  }
  if (page.structural.length > STATEMENT_CAP) {
    out.push(
      `- … ${page.structural.length - STATEMENT_CAP} more — see the diff below`,
    );
  }
  out.push("");
  return out;
}

/** Per-view unified diff, rendered inline as ```diff blocks (not in <details>
 * — email keeps the green/red coloring). */
function mdViewDiff(page: PageDiff, maxLines: number): string[] {
  const { blocks, hidden } = cappedBlocks(page, maxLines);
  const out: string[] = [];
  for (const b of blocks) {
    const fence = fenceFor(b.lines);
    out.push(`_${b.view}_`, "", `${fence}diff`, ...b.lines, fence, "");
  }
  if (hidden > 0) {
    out.push(
      `_… ${hidden} more diff line${plural(hidden)} — see the full diff in the job log._`,
      "",
    );
  }
  return out;
}

export interface DiffMarkdownOptions {
  explain?: boolean;
  maxLines?: number;
  maxPages?: number;
}

export function renderDiffMarkdown(
  result: DiffResult,
  options: DiffMarkdownOptions = {},
): string {
  const explain = options.explain ?? false;
  const maxLines = options.maxLines ?? Infinity;
  const maxPages = options.maxPages ?? Infinity;
  const { new: n, changed, removed } = result.summary;
  const noFindings = n === 0 && changed === 0 && removed === 0;

  const changedPages = result.pages.filter(isChanged);
  const structPages = result.pages.filter(hasHunks).length;
  // "structure changed on N pages" is a fact (the serialized views differ), so
  // it rides the header in both modes — an all-zero findings triplet otherwise
  // reads as "nothing changed" in an email title.
  const structHeader =
    structPages > 0
      ? ` · structure changed on ${structPages} page${plural(structPages)}`
      : "";
  const out: string[] = [
    `### Accessibility diff — ${n} new · ${changed} changed · ${removed} fixed${structHeader}`,
    "",
  ];

  if (noFindings) {
    out.push(
      structPages > 0
        ? explain
          ? "No accessibility finding changes — but the semantic structure moved (advisory, review below)."
          : "No accessibility finding changes — the structural diff is below."
        : "No accessibility finding changes.",
      "",
    );
  }

  // Route index — scan the affected pages at a glance before the details.
  if (changedPages.length >= 2) {
    out.push(
      `**Pages with a11y changes (${changedPages.length}):** ${pageList(changedPages)}`,
      "",
    );
  }

  const detailed = changedPages.slice(0, maxPages);
  const overflow = changedPages.slice(maxPages);

  for (const page of detailed) {
    // Page names come from config and notes wrap arbitrary error strings —
    // both are page-controlled, so escape them before they hit the heading /
    // prose (a name/error with `<`, `**`, or `</details>` must not inject).
    if (page.status === "incomparable") {
      out.push(
        `#### ${mdEscape(page.name)}`,
        "",
        `⚠️ incomparable — ${mdEscape(page.note ?? "a snapshot errored")}`,
        "",
      );
      continue;
    }
    out.push(`#### ${mdEscape(page.name)}`, "");
    const shown = shownEntries(page);
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
    if (explain) out.push(...mdStatements(page));
    out.push(...mdViewDiff(page, maxLines));
  }

  if (overflow.length) {
    out.push(
      `_… and ${overflow.length} more page${plural(overflow.length)} with changes: ${pageList(overflow)} — see the full diff in the job log._`,
      "",
    );
  }

  if (explain && structPages > 0) {
    out.push(
      "_Structural notes are advisory and never fail the check; container/nesting moves are not tracked._",
      "",
    );
  } else if (!explain && structPages > 0) {
    out.push(
      "_Run with `--explain` for a plain-language summary of the structural changes._",
      "",
    );
  }
  return `${out.join("\n")}`;
}
