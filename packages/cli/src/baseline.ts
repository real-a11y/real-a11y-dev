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
import { CliError } from "./exit.js";
import type { FingerprintId, FingerprintedFinding } from "./fingerprint.js";

export const BASELINE_SCHEMA_VERSION = 1;
export const DEFAULT_BASELINE_PATH = ".a11y-baseline.json";

/** One accepted finding. The identity fields feed the matcher; `message` (and
 *  the rest) make the committed file reviewable; `note` is yours to keep. */
export interface BaselineEntry {
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

/** A page's current findings, keyed by the stable config name (never the URL). */
export interface BaselinePage {
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
  page: string,
  f: FingerprintedFinding,
  note?: string,
): BaselineEntry {
  return {
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
    throw new CliError(
      `baseline file not found or unreadable: ${abs}`,
      "create it first: real-a11y snapshot --update-baseline",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CliError(`baseline is not valid JSON: ${abs}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new CliError(`baseline must be a JSON object: ${abs}`);
  }
  const b = parsed as Partial<Baseline>;
  if (b.schemaVersion !== BASELINE_SCHEMA_VERSION) {
    throw new CliError(
      `baseline has schemaVersion ${String(b.schemaVersion)} — this build reads ${BASELINE_SCHEMA_VERSION}.`,
      "regenerate it: real-a11y snapshot --update-baseline",
    );
  }
  if (!Array.isArray(b.entries)) {
    throw new CliError(`baseline has no "entries" array: ${abs}`);
  }
  for (const e of b.entries) {
    if (
      typeof e !== "object" ||
      e === null ||
      typeof (e as BaselineEntry).fingerprint !== "string" ||
      typeof (e as BaselineEntry).page !== "string" ||
      !Array.isArray((e as BaselineEntry).id)
    ) {
      throw new CliError(`baseline has a malformed entry: ${abs}`);
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
    const pool = byPage.get(e.page);
    if (pool) pool.push(e);
    else byPage.set(e.page, [e]);
  }

  let suppressed = 0;
  const matchedEntries = new Set<BaselineEntry>();
  const currentNames = new Set(pages.map((p) => p.name));

  for (const page of pages) {
    const entries = byPage.get(page.name);
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
    (e) => !matchedEntries.has(e) || !currentNames.has(e.page),
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
    const pool = oldByPage.get(e.page);
    if (pool) pool.push(e);
    else oldByPage.set(e.page, [e]);
  }

  const carriedNote = new Map<FingerprintedFinding, string>();
  const matchedOld = new Set<BaselineEntry>();
  let added = 0;

  for (const page of pages) {
    const oldEntries = oldByPage.get(page.name) ?? [];
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
        findingToEntry(page.name, f, carriedNote.get(f)),
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
