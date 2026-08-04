/**
 * Baselines (`.a11y-baseline.json`) — "adopt the gate on a codebase that
 * already has a11y debt." A baseline is the set of findings you've chosen to
 * accept for now; `--baseline` suppresses them (they stay in the report, marked
 * `suppressed`, but drop out of the `--fail-on` count and `diff`'s NEW gate), so
 * only genuinely new findings fail the build. `--update-baseline` regenerates
 * the file from the current findings.
 *
 * Matching reuses the SAME two-tier matcher as `diff` (baseline = the base
 * side), so a re-indented subtree or a renumbered `:nth-of-type` locator doesn't
 * silently un-suppress a finding you'd already accepted. Entries carry the full
 * identity + a human-readable message (a committed baseline should be
 * reviewable), plus an optional `note` that survives `--update-baseline`.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { Finding } from "@real-a11y-dev/audit";

import { diffFindings } from "./diff/findings-diff.js";
import { SnapshotFormatError } from "./errors.js";
import type { FingerprintId, FingerprintedFinding } from "./fingerprint.js";

/**
 * Bumped to 2 when pages gained an identity separate from their display label.
 *
 * A v1 baseline stores only `page` — the label — and carries no `url`, so unlike
 * a snapshot artifact its identity cannot be derived and back-filled. Rather
 * than guess a mapping (a wrong guess would silently suppress a real finding,
 * the one outcome worth avoiding outright), a v1 file is refused with the
 * command that regenerates it.
 */
export const BASELINE_SCHEMA_VERSION = 2;
export const DEFAULT_BASELINE_PATH = ".a11y-baseline.json";

/** One accepted finding. The identity fields feed the matcher; `message` (and
 *  the rest) make the committed file reviewable; `note` is yours to keep. */
export interface BaselineEntry {
  /**
   * The page's identity — the bucket this entry is matched in. Derived from the
   * URL's path, never from the display label: a page renamed for readability
   * must keep suppressing debt already accepted for it.
   *
   * Named `pageId` because `id` on this type is already the fingerprint tuple.
   */
  pageId: string;
  /** The page's display label at record time — for reviewing the file. */
  page: string;
  fingerprint: string;
  id: FingerprintId;
  rule: string;
  severity: Finding["severity"];
  message: string;
  role?: string;
  tagName?: string;
  locator?: string;
  context?: string;
  name?: string;
  note?: string;
}

export interface Baseline {
  schemaVersion: number;
  entries: BaselineEntry[];
}

/**
 * A page's current findings, keyed by the page's **id** — its identity, derived
 * from the URL's path. Never the display name: a page renamed for readability
 * must keep suppressing the debt already accepted for it, and while this bucket
 * was keyed on the label a rename silently un-suppressed every entry.
 *
 * `name` rides along so a stored entry stays readable in review.
 */
export interface BaselinePage {
  id: string;
  name: string;
  findings: FingerprintedFinding[];
}

/** Reconstruct the matcher-facing finding from a stored entry (exact — the
 *  identity fields were stored verbatim, so `componentsOf` reproduces them). */
function entryToFinding(e: BaselineEntry): FingerprintedFinding {
  return {
    rule: e.rule as Finding["rule"],
    severity: e.severity,
    message: e.message,
    ...(e.role !== undefined ? { role: e.role } : {}),
    ...(e.tagName !== undefined ? { tagName: e.tagName } : {}),
    ...(e.locator !== undefined ? { locator: e.locator } : {}),
    ...(e.context !== undefined ? { context: e.context } : {}),
    ...(e.name !== undefined ? { name: e.name } : {}),
    id: e.id,
    fingerprint: e.fingerprint,
  } as FingerprintedFinding;
}

function findingToEntry(
  pageId: string,
  page: string,
  f: FingerprintedFinding,
  note?: string,
): BaselineEntry {
  return {
    pageId,
    page,
    fingerprint: f.fingerprint,
    id: f.id,
    rule: f.rule,
    severity: f.severity,
    message: f.message,
    ...(f.role !== undefined ? { role: f.role } : {}),
    ...(f.tagName !== undefined ? { tagName: f.tagName } : {}),
    ...(f.locator !== undefined ? { locator: f.locator } : {}),
    ...(f.context !== undefined ? { context: f.context } : {}),
    ...(f.name !== undefined ? { name: f.name } : {}),
    ...(note ? { note } : {}),
  };
}

/** Load + validate a baseline. Fail-closed: a malformed baseline is a hard
 *  error, never a silent "suppress nothing" (which would un-gate every finding
 *  the file was supposed to accept). */
export function loadBaseline(path: string): Baseline {
  const abs = resolve(path);
  let raw: string;
  try {
    raw = readFileSync(abs, "utf8");
  } catch {
    throw new SnapshotFormatError(
      `baseline file not found or unreadable: ${abs}`,
      "create it first: real-a11y snapshot --update-baseline",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new SnapshotFormatError(`baseline is not valid JSON: ${abs}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new SnapshotFormatError(`baseline must be a JSON object: ${abs}`);
  }
  const b = parsed as Partial<Baseline>;
  if (b.schemaVersion !== BASELINE_SCHEMA_VERSION) {
    throw new SnapshotFormatError(
      b.schemaVersion === 1
        ? `baseline is schemaVersion 1, recorded before pages had an identity separate from their name — this build reads ${BASELINE_SCHEMA_VERSION}. Its entries key on the display label, which cannot be mapped to a page id without guessing, and a wrong guess would silently suppress a real finding.`
        : `baseline has schemaVersion ${String(b.schemaVersion)} — this build reads ${BASELINE_SCHEMA_VERSION}.`,
      "re-record it against the current build, reviewing the diff: real-a11y snapshot --update-baseline",
    );
  }
  if (!Array.isArray(b.entries)) {
    throw new SnapshotFormatError(`baseline has no "entries" array: ${abs}`);
  }
  for (const e of b.entries) {
    if (
      typeof e !== "object" ||
      e === null ||
      typeof (e as BaselineEntry).fingerprint !== "string" ||
      typeof (e as BaselineEntry).page !== "string" ||
      typeof (e as BaselineEntry).pageId !== "string" ||
      !Array.isArray((e as BaselineEntry).id)
    ) {
      throw new SnapshotFormatError(`baseline has a malformed entry: ${abs}`);
    }
  }
  return b as Baseline;
}

/**
 * Suppress current findings that the baseline already accepts. Mutates the
 * matched findings (`suppressed = true`) — they stay in the report but leave the
 * gate — and returns the baseline entries no current finding matched (stale
 * debt that's since been fixed). Stale entries are a stderr warning, never a
 * failure.
 */
export function applyBaseline(
  pages: readonly BaselinePage[],
  baseline: Baseline,
): { suppressed: number; stale: BaselineEntry[] } {
  const byPage = new Map<string, BaselineEntry[]>();
  for (const e of baseline.entries) {
    const pool = byPage.get(e.pageId);
    if (pool) pool.push(e);
    else byPage.set(e.pageId, [e]);
  }

  let suppressed = 0;
  const matchedEntries = new Set<BaselineEntry>();
  const currentIds = new Set(pages.map((p) => p.id));

  for (const page of pages) {
    const entries = byPage.get(page.id);
    if (!entries || entries.length === 0) continue;
    // Reconstruct base findings; keep a reference back to each source entry so a
    // "removed" (unmatched-base) result maps to the right stale entry.
    const baseFindings = entries.map(entryToFinding);
    const entryOf = new Map<FingerprintedFinding, BaselineEntry>();
    baseFindings.forEach((f, i) => entryOf.set(f, entries[i]));

    for (const d of diffFindings(baseFindings, page.findings)) {
      if (d.kind === "unchanged" || d.kind === "changed") {
        d.finding.suppressed = true;
        suppressed += 1;
        if (d.base) matchedEntries.add(entryOf.get(d.base) as BaselineEntry);
      }
    }
  }

  const stale = baseline.entries.filter(
    (e) => !matchedEntries.has(e) || !currentIds.has(e.pageId),
  );
  return { suppressed, stale };
}

/**
 * Regenerate a baseline from the current findings, carrying forward the `note`
 * of every still-matched entry. Deterministic order (page, rule, fingerprint,
 * occ) so a re-run is a no-op diff. Returns `added` (new findings not in the old
 * baseline) and `removed` (stale entries dropped).
 */
export function buildBaseline(
  pages: readonly BaselinePage[],
  old?: Baseline,
): { baseline: Baseline; added: number; removed: number } {
  const oldByPage = new Map<string, BaselineEntry[]>();
  for (const e of old?.entries ?? []) {
    const pool = oldByPage.get(e.pageId);
    if (pool) pool.push(e);
    else oldByPage.set(e.pageId, [e]);
  }

  const carriedNote = new Map<FingerprintedFinding, string>();
  const matchedOld = new Set<BaselineEntry>();
  let added = 0;

  for (const page of pages) {
    const oldEntries = oldByPage.get(page.id) ?? [];
    const baseFindings = oldEntries.map(entryToFinding);
    const entryOf = new Map<FingerprintedFinding, BaselineEntry>();
    baseFindings.forEach((f, i) => entryOf.set(f, oldEntries[i]));

    for (const d of diffFindings(baseFindings, page.findings)) {
      if (d.kind === "new") {
        added += 1;
      } else if ((d.kind === "unchanged" || d.kind === "changed") && d.base) {
        const oldEntry = entryOf.get(d.base);
        if (oldEntry) {
          matchedOld.add(oldEntry);
          if (oldEntry.note) carriedNote.set(d.finding, oldEntry.note);
        }
      }
    }
  }

  const entries = pages
    .flatMap((page) =>
      page.findings.map((f) =>
        findingToEntry(page.id, page.name, f, carriedNote.get(f)),
      ),
    )
    .sort(byCanonicalOrder);

  const removed = (old?.entries.length ?? 0) - matchedOld.size;
  return {
    baseline: { schemaVersion: BASELINE_SCHEMA_VERSION, entries },
    added,
    removed,
  };
}

/** Stable order so a committed baseline only churns when findings change. */
function byCanonicalOrder(a: BaselineEntry, b: BaselineEntry): number {
  return (
    a.page.localeCompare(b.page) ||
    a.rule.localeCompare(b.rule) ||
    a.fingerprint.localeCompare(b.fingerprint) ||
    lastOcc(a.id) - lastOcc(b.id)
  );
}

function lastOcc(id: FingerprintId): number {
  const occ = id[id.length - 1];
  return typeof occ === "number" ? occ : 0;
}

export function serializeBaseline(baseline: Baseline): string {
  return `${JSON.stringify(baseline, null, 2)}\n`;
}
