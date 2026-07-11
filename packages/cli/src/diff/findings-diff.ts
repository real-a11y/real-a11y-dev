/**
 * Findings-aware diff — the one genuinely new algorithm, and the thing that
 * makes `diff` more than "the same tool twice". It classifies two sets of
 * findings (base vs PR) as NEW / REMOVED / CHANGED / UNCHANGED, robust to the
 * DOM churn that makes a line-level text diff useless (a re-indented subtree,
 * an inserted sibling that renumbers every `:nth-of-type`).
 *
 * Two tiers:
 *   1. exact fingerprint match — same identity tuple, O(n+m).
 *   2. greedy best-match over the remainder, per rule, scored on
 *      locator/context/tag similarity above a threshold — pairs "the same
 *      finding that drifted" so it reads as CHANGED (or UNCHANGED for
 *      locator-only drift), not FIXED+NEW.
 *
 * Only NEW findings gate a build (see the command); REMOVED/CHANGED never do.
 */

import {
  componentsOf,
  isDocScopedRule,
  type FindingComponents,
  type FingerprintedFinding,
} from "../fingerprint.js";

export type DiffClass = "new" | "removed" | "changed" | "unchanged";

export interface DiffEntry {
  kind: DiffClass;
  /** The PR-side finding, except for "removed" where it's the base finding. */
  finding: FingerprintedFinding;
  /** The base-side finding a "changed" entry was matched to. */
  base?: FingerprintedFinding;
  /** Human-readable field deltas for a "changed" entry. */
  changes?: string[];
}

export interface DiffSummary {
  new: number;
  removed: number;
  changed: number;
  unchanged: number;
}

const MATCH_THRESHOLD = 2;

/** Bare `#id` anchors compare by equality; path anchors by segment overlap. */
function isBareId(anchor: string): boolean {
  return anchor.startsWith("#") && !anchor.includes(" ");
}

function locatorSim(a: FindingComponents, b: FindingComponents): number {
  if (!a.anchor || !b.anchor) return 0;
  if (isBareId(a.anchor) || isBareId(b.anchor)) {
    return a.anchor === b.anchor ? 1 : 0;
  }
  const sa = new Set(a.anchor.split(" > "));
  const sb = new Set(b.anchor.split(" > "));
  let inter = 0;
  for (const s of sa) if (sb.has(s)) inter += 1;
  const union = new Set([...sa, ...sb]).size;
  return union === 0 ? 0 : inter / union;
}

/**
 * Similarity score for two same-rule findings. ≥ {@link MATCH_THRESHOLD} pairs
 * them. `role`/`kind` mismatch is a hard filter (can't pair two unrelated
 * things); an id-locator match alone (2×1) clears the bar, but `role+tagName`
 * alone (0.5) never can.
 */
function score(a: FingerprintedFinding, b: FingerprintedFinding): number {
  const ca = componentsOf(a);
  const cb = componentsOf(b);
  if (ca.docScoped !== cb.docScoped) return -1;
  if (ca.docScoped) {
    if (ca.kind !== cb.kind) return -1;
    // Name-bearing kinds (skipped-level) must agree on the name, else fixing
    // "Details" while introducing "Pricing" would read as one CHANGED.
    if (ca.name || cb.name) return ca.name === cb.name ? MATCH_THRESHOLD : -1;
    return MATCH_THRESHOLD;
  }
  if (ca.role !== cb.role) return -1;
  let s = ca.tagName === cb.tagName ? 0.5 : 0;
  s += 2 * locatorSim(ca, cb);
  s += ca.context && ca.context === cb.context ? 1 : 0;
  return s;
}

/** Fields whose change turns a matched pair from UNCHANGED into CHANGED. */
function materialChanges(
  base: FingerprintedFinding,
  pr: FingerprintedFinding,
): string[] {
  const out: string[] = [];
  if (base.severity !== pr.severity) {
    out.push(`severity ${base.severity} → ${pr.severity}`);
  }
  if ((base.tagName ?? "") !== (pr.tagName ?? "")) {
    out.push(`tag <${base.tagName ?? "?"}> → <${pr.tagName ?? "?"}>`);
  }
  if ((base.context ?? "") !== (pr.context ?? "")) {
    out.push(`context ${base.context ?? "(none)"} → ${pr.context ?? "(none)"}`);
  }
  // Message last: for doc findings it carries the count ("found 2 → found 3"),
  // the whole point of matching them across a change.
  if (base.message !== pr.message) {
    out.push(`"${base.message}" → "${pr.message}"`);
  }
  return out;
}

function recordMatch(
  base: FingerprintedFinding,
  pr: FingerprintedFinding,
  into: DiffEntry[],
): void {
  const changes = materialChanges(base, pr);
  into.push(
    changes.length
      ? { kind: "changed", finding: pr, base, changes }
      : { kind: "unchanged", finding: pr, base },
  );
}

/**
 * Classify `pr` findings against `base` findings for ONE page (already joined
 * by name). Returns an entry per base+PR finding; consumers filter to the
 * classes they render/gate on.
 */
export function diffFindings(
  base: readonly FingerprintedFinding[],
  pr: readonly FingerprintedFinding[],
): DiffEntry[] {
  const entries: DiffEntry[] = [];
  const baseUsed = new Array<boolean>(base.length).fill(false);
  const prUsed = new Array<boolean>(pr.length).fill(false);

  // ── Tier 1: exact fingerprint (occ included) ──────────────────────────────
  const baseByFp = new Map<string, number[]>();
  base.forEach((f, i) => {
    const pool = baseByFp.get(f.fingerprint);
    if (pool) pool.push(i);
    else baseByFp.set(f.fingerprint, [i]);
  });
  pr.forEach((f, j) => {
    const pool = baseByFp.get(f.fingerprint);
    if (pool && pool.length) {
      const i = pool.shift() as number;
      baseUsed[i] = true;
      prUsed[j] = true;
      recordMatch(base[i], f, entries);
    }
  });

  // ── Tier 2: greedy best-match over the remainder, per rule ────────────────
  const cands: { s: number; bi: number; pi: number }[] = [];
  for (let bi = 0; bi < base.length; bi++) {
    if (baseUsed[bi]) continue;
    for (let pi = 0; pi < pr.length; pi++) {
      if (prUsed[pi]) continue;
      if (base[bi].rule !== pr[pi].rule) continue;
      const s = score(base[bi], pr[pi]);
      if (s >= MATCH_THRESHOLD) cands.push({ s, bi, pi });
    }
  }
  // Deterministic: higher score first, then document order on each side.
  cands.sort((x, y) => y.s - x.s || x.bi - y.bi || x.pi - y.pi);
  for (const c of cands) {
    if (baseUsed[c.bi] || prUsed[c.pi]) continue;
    baseUsed[c.bi] = true;
    prUsed[c.pi] = true;
    recordMatch(base[c.bi], pr[c.pi], entries);
  }

  // ── Unmatched → removed (base) / new (pr) ─────────────────────────────────
  base.forEach((f, i) => {
    if (!baseUsed[i]) entries.push({ kind: "removed", finding: f });
  });
  pr.forEach((f, j) => {
    if (!prUsed[j]) entries.push({ kind: "new", finding: f });
  });

  return entries;
}

export function summarize(entries: readonly DiffEntry[]): DiffSummary {
  const s: DiffSummary = { new: 0, removed: 0, changed: 0, unchanged: 0 };
  for (const e of entries) s[e.kind] += 1;
  return s;
}

export { isDocScopedRule };
