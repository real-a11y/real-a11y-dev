/**
 * A11y snapshot **checkpoints** — the Axis-B (findings) diff, inside the MCP
 * server. An agent saves a named checkpoint of the live page, then asks what
 * findings are new / changed / fixed after a change — with the *same* identity
 * semantics (`v1:` fingerprints) the CI a11y-diff bot uses, guaranteed by the
 * shared `buildSnapshotPage` in `@real-a11y-dev/snapshot`.
 *
 * This module is the pure, testable core: the in-memory store and the diff
 * rendering. The tool wiring lives in `server.ts`.
 */

import {
  buildArtifact,
  diffArtifacts,
  fingerprintFindings,
  viewsOfPage,
  type DiffClass,
  type DiffEntry,
  type DiffResult,
  type FingerprintedFinding,
  type SnapshotArtifact,
  type SnapshotPage,
} from "@real-a11y-dev/snapshot";

/** Default number of checkpoints retained before the oldest is evicted. */
export const MAX_CHECKPOINTS = 20;

/**
 * A stored checkpoint: the snapshotted page plus the rule subset it was
 * captured with. The rules are remembered so a later `diff_findings`
 * re-snapshots with the SAME rules — otherwise a checkpoint saved with a subset
 * would diff against an all-rules re-snapshot and report the omitted rules'
 * findings as spurious NEW (or FIXED). `undefined` means "all rules".
 */
export interface Checkpoint {
  page: SnapshotPage;
  rules?: string[];
}

/**
 * A bounded, insertion-ordered store of named checkpoints. Re-saving a name
 * moves it to newest; once full, the least-recently-saved checkpoint is
 * evicted, so a runaway agent can't grow the map without bound.
 */
export class CheckpointStore<T = Checkpoint> {
  private readonly map = new Map<string, T>();

  constructor(private readonly cap: number = MAX_CHECKPOINTS) {}

  save(name: string, value: T): void {
    this.map.delete(name); // re-save ⇒ move to newest
    this.map.set(name, value);
    while (this.map.size > this.cap) {
      const oldest = this.map.keys().next().value as string;
      this.map.delete(oldest);
    }
  }

  get(name: string): T | undefined {
    return this.map.get(name);
  }

  has(name: string): boolean {
    return this.map.has(name);
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }

  entries(): Array<[string, T]> {
    return [...this.map];
  }
}

// The artifact metadata is irrelevant to the findings diff (diffArtifacts joins
// pages by name and matches findings by fingerprint) — a placeholder is fine.
const DIFF_META = { toolName: "@real-a11y-dev/mcp", toolVersion: "0" } as const;

/**
 * Wrap a stored page so `diffArtifacts` can consume it — declaring the views
 * THIS page actually carries, not a blanket "all three".
 *
 * It matters because the two sides can disagree: `import_checkpoint` accepts an
 * externally-held artifact, so a DOM-era base (with a tabs view) can meet a
 * native head (without one). Claiming both measured tab order would diff N stops
 * against nothing and report every one as removed — the loudest possible false
 * alarm, on a page where nothing changed. The page is the source of truth here.
 */
function asArtifact(page: SnapshotPage): SnapshotArtifact {
  return buildArtifact([page], {
    ...DIFF_META,
    views: viewsOfPage(page),
  });
}

/**
 * Warn when the two sides were captured at different scopes.
 *
 * A checkpoint records the root it was taken at. Reads are whole-document now,
 * so a live re-snapshot is always `body` — but `import_checkpoint` accepts
 * externally-held artifacts, and a DOM-era one may have been captured at
 * `[role=dialog]`. Diffing that against a whole-page head matches the old
 * findings by fingerprint (nothing reads as fixed) while every finding OUTSIDE
 * the old subtree arrives as NEW — the one class that gates CI.
 *
 * The comparison is still worth showing; it just isn't like-for-like, and an
 * agent has no way to notice on its own. The CLI says the same thing about the
 * same widening (`warnUnscopable`); this is the MCP half of it.
 */
export function scopeMismatch(
  base: SnapshotPage,
  head: SnapshotPage,
): string | undefined {
  const from = base.root || "body";
  const to = head.root || "body";
  if (from === to) return undefined;
  return (
    `NOTE: scope changed — the base was captured at \`${from}\`, this side at \`${to}\`. ` +
    `Findings from outside \`${from}\` will appear as NEW even though nothing changed. ` +
    `Re-capture the base at the same scope for a like-for-like diff.`
  );
}

/**
 * Everything after the origin — path, query and fragment.
 *
 * `undefined` for anything that isn't a parseable absolute URL. A stored page's
 * `url` has been through `redactUrl`, which falls back to sanitized raw text
 * when the input wasn't a URL at all, so this can legitimately fail.
 */
function resourceOf(url: string): string | undefined {
  try {
    const u = new URL(url);
    // `/pricing` and `/pricing/` are the same page; treat them as such.
    const path = u.pathname.length > 1 ? u.pathname.replace(/\/$/, "") : "/";
    return `${path}${u.search}${u.hash}`;
  } catch {
    return undefined;
  }
}

/**
 * Are these two sides *different pages*, rather than the same page twice?
 *
 * Deliberately compares only what follows the origin. A checkpoint diff across
 * two deploys of one page — `staging.example.com/pricing` vs
 * `example.com/pricing`, or `localhost:3000` vs `localhost:3001` — is the
 * documented workflow for both diff tools, and there the structural summary is
 * the whole point. `SnapshotPage.name` says the same thing from the other
 * direction: it is the join key *"never the URL (host/port legitimately
 * differ)"*.
 *
 * What the origin can't tell apart is `/pricing` vs `/careers`. That is the case
 * worth catching, and the path is what catches it.
 *
 * Returns the two addresses when they differ, `undefined` otherwise —
 * INCLUDING when either side is unparseable or empty. Never claim a mismatch
 * that can't be shown: silently dropping a section on a guess is worse than
 * printing a noisy one.
 */
export function differentUrl(
  base: SnapshotPage,
  head: SnapshotPage,
): { from: string; to: string } | undefined {
  const from = resourceOf(base.url);
  const to = resourceOf(head.url);
  if (from === undefined || to === undefined || from === to) return undefined;
  return { from: base.url, to: head.url };
}

/**
 * Diff two checkpoint pages that were fingerprinted under the **same** page
 * name (the `checkpoint_findings`/`diff_findings` pair, or a re-snapshot vs its
 * stored base). Their fingerprints are directly comparable.
 */
export function diffCheckpointPages(
  base: SnapshotPage,
  head: SnapshotPage,
): DiffResult {
  return diffArtifacts(asArtifact(base), asArtifact(head));
}

/**
 * Diff two **independently-labeled** checkpoints (`diff_checkpoints`). Each was
 * fingerprinted under its own label as the page name — and `page` is part of
 * the `v1` fingerprint tuple — so a naive diff would read every finding as
 * removed+new. Re-fingerprint both under one neutral name first; the identity
 * *components* (rule, role, locator, …) are unchanged, so matching findings
 * collapse correctly.
 */
export function diffLabeledCheckpoints(
  base: SnapshotPage,
  head: SnapshotPage,
): DiffResult {
  const NAME = "checkpoint";
  const rename = (p: SnapshotPage): SnapshotPage => ({
    ...p,
    name: NAME,
    findings: fingerprintFindings(NAME, p.findings),
  });
  return diffCheckpointPages(rename(base), rename(head));
}

// ── rendering ────────────────────────────────────────────────────────────

/** Cap per-section entries so a massively-changed page produces a bounded,
 *  readable delta rather than thousands of lines. A pathological diff (hundreds
 *  of long messages) can still brush the server's outer `bounded()` cap — that
 *  mid-line truncation is acceptable for human-readable text, unlike the JSON
 *  export, which errors rather than emit invalid JSON. */
const MAX_ENTRIES = 200;
const MAX_STRUCTURAL = 50;

function fmtFinding(f: FingerprintedFinding): string {
  const where = f.locator ? `  ${f.locator}` : "";
  return `[${f.severity}] ${f.rule}: ${f.message}${where}`;
}

export interface RenderDiffOptions {
  /** Name the two sides (`diff_checkpoints`); omit for a re-snapshot vs. saved. */
  labels?: { base: string; head: string };
  /**
   * The two addresses when the sides are different pages — pass
   * {@link differentUrl}'s result straight through.
   *
   * Supplying it does two things at once: prints the note, and drops the
   * structural summary. One input driving both is the point — a diff can then
   * never suppress the section without saying why, nor say why while still
   * printing it.
   */
  differentUrl?: { from: string; to: string };
}

/**
 * Render a {@link DiffResult} as a compact, agent-readable delta: NEW (the only
 * class that gates CI) → CHANGED → FIXED, plus an advisory structural summary.
 */
export function renderDiff(
  diff: DiffResult,
  options: RenderDiffOptions = {},
): string {
  const { labels, differentUrl: differing } = options;
  const s = diff.summary;
  const title = labels
    ? `Checkpoint diff ${labels.base} → ${labels.head}`
    : "Checkpoint diff (vs. saved)";
  const header = `${title}: ${s.new} new, ${s.removed} fixed, ${s.changed} changed, ${s.unchanged} unchanged.`;

  // Two different pages' trees differ almost everywhere, so the summary would
  // describe a rewrite rather than a regression — pages, headings and tab stops
  // reported wholesale as added and removed. Findings still diff usefully
  // (fingerprints match on rule + role + locator, not on position), so the
  // section goes and the rest stays.
  const note = differing
    ? `NOTE: different page — the base was captured at \`${differing.from}\`, this side at \`${differing.to}\`. ` +
      `The structural summary is suppressed: two different pages differ almost everywhere, so it would describe a rewrite, not a regression. ` +
      `Findings are still matched by fingerprint.`
    : undefined;
  const lead = note ? [header, note] : [header];

  const findingsChanged = s.new + s.removed + s.changed > 0;
  // Suppressed counts as "no structural change to show" everywhere below —
  // otherwise a URL-mismatched diff with no findings change would announce
  // "the structure did" and then print nothing under it.
  const structuralChanged =
    !differing && diff.pages.some((p) => p.structural.length > 0);

  // Only short-circuit when NOTHING moved. A deploy can leave every finding
  // identical while reshuffling the page — suppressing the advisory structural
  // summary there would silently drop the most useful signal in the
  // cross-deploy workflow (and both tools promise that summary).
  if (!findingsChanged && !structuralChanged) {
    return [...lead, "No accessibility findings changed."].join("\n");
  }

  const out: string[] = [...lead];
  if (!findingsChanged) {
    out.push("", "No accessibility findings changed — but the structure did:");
  }
  const pick = (entries: DiffEntry[], kind: DiffClass) =>
    entries.filter((e) => e.kind === kind);

  const section = (
    heading: string,
    entries: DiffEntry[],
    mark: string,
    withChanges = false,
  ) => {
    if (entries.length === 0) return;
    out.push("", `${heading} (${entries.length}):`);
    for (const e of entries.slice(0, MAX_ENTRIES)) {
      const delta =
        withChanges && e.changes?.length ? `  — ${e.changes.join("; ")}` : "";
      out.push(`  ${mark} ${fmtFinding(e.finding)}${delta}`);
    }
    if (entries.length > MAX_ENTRIES) {
      out.push(`  … +${entries.length - MAX_ENTRIES} more`);
    }
  };

  for (const page of diff.pages) {
    section("NEW — gates CI", pick(page.entries, "new"), "✖");
    section("CHANGED", pick(page.entries, "changed"), "~", true);
    section("FIXED", pick(page.entries, "removed"), "✓");

    if (!differing && page.structural.length > 0) {
      out.push("", "Structural changes (advisory):");
      for (const c of page.structural.slice(0, MAX_STRUCTURAL)) {
        out.push(`  • ${c.message}`);
      }
      if (page.structural.length > MAX_STRUCTURAL) {
        out.push(`  … +${page.structural.length - MAX_STRUCTURAL} more`);
      }
    }
  }

  return out.join("\n");
}
