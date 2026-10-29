/**
 * Line grammar, multiset and raw-text helpers for the views summary — the
 * parsing and counting primitives the pipeline in views-summary.ts builds on.
 */

import { stripFocusMarker, stripTabIndex } from "./views-diff.js";
import type { ViewChange } from "./views-summary.js";

// Sentinels emitted by @real-a11y-dev/serialize for empty views.
export const NO_HEADINGS = "(no headings)";
export const NOTHING_FOCUSABLE = "(nothing focusable)";

/** Reorder detection is O(n·m) LCS — skip pathological pages. */
export const REORDER_LCS_LIMIT = 500;

export type Ignore = ((trimmedLine: string) => boolean) | undefined;

// ── line grammar ─────────────────────────────────────────────────────────────

export interface ParsedLine {
  role: string;
  /** Accessible name; undefined when the line has none. Unescaped. */
  name?: string;
  /** `(level N)` suffix — legal on any role, not just headings. */
  level?: number;
}

/**
 * Parse a tree or tabs view line: `ROLE [ "NAME" ] [ (level N) ]`. The level
 * suffix is stripped FIRST (end-anchored, so a literal "(level 2)" inside a
 * quoted name never matches); names are NOT quote-escaped, so the name is
 * everything between the first `"` and the LAST `"`.
 */
export function parseRoleLine(line: string): ParsedLine {
  let rest = stripFocusMarker(line);
  let level: number | undefined;
  const suffix = / \(level (\d+)\)$/.exec(rest);
  if (suffix) {
    level = Number(suffix[1]);
    rest = rest.slice(0, rest.length - suffix[0].length);
  }
  const space = rest.indexOf(" ");
  if (space === -1) {
    return level === undefined ? { role: rest } : { role: rest, level };
  }
  const role = rest.slice(0, space);
  const tail = rest.slice(space + 1);
  if (tail.length >= 2 && tail.startsWith('"') && tail.endsWith('"')) {
    const name = tail.slice(1, -1);
    return level === undefined ? { role, name } : { role, name, level };
  }
  // Unexpected shape — keep the role, let the line ride to the rollup.
  return level === undefined ? { role } : { role, level };
}

/** Outline line: `h{N} NAME` (name may be absent — an unnamed heading trims
 * from `h2 ` to `h2`). Levels 0 and 7+ are legal via aria-level. */
export function parseOutlineLine(
  line: string,
): { level: number; name: string } | null {
  const m = /^h(\d+)(?: (.*))?$/.exec(stripFocusMarker(line));
  if (!m) return null;
  return { level: Number(m[1]), name: m[2] ?? "" };
}

// ── multiset helpers ─────────────────────────────────────────────────────────

export type Multiset = Map<string, number>;

export function toMultiset(lines: readonly string[]): Multiset {
  const ms: Multiset = new Map();
  for (const line of lines) ms.set(line, (ms.get(line) ?? 0) + 1);
  return ms;
}

export function take(ms: Multiset, key: string, n = 1): number {
  const have = ms.get(key) ?? 0;
  const taken = Math.min(have, n);
  if (taken === 0) return 0;
  if (have === taken) ms.delete(key);
  else ms.set(key, have - taken);
  return taken;
}

export function total(ms: Multiset): number {
  let sum = 0;
  for (const n of ms.values()) sum += n;
  return sum;
}

/** Consume up to `n` tree lines matching (role, name), tolerating any
 * `(level N)` suffix — a role-overridden focusable carries a level in the tree
 * but never in the tabs view. Consuming `n` (not 1) matters when a tabs
 * statement coalesces N identical stops: leaving N−1 tree lines behind would
 * re-report them in the interactive stage. */
export function takeByRoleName(
  ms: Multiset,
  role: string,
  name: string,
  n = 1,
): void {
  let remaining = n;
  for (const key of [...ms.keys()]) {
    if (remaining === 0) break;
    const parsed = parseRoleLine(key);
    if (parsed.role === role && (parsed.name ?? "") === name) {
      remaining -= take(ms, key, remaining);
    }
  }
}

// ── raw-text scans ───────────────────────────────────────────────────────────

export function rawLines(text: string, ignore: Ignore): string[] {
  const lines: string[] = [];
  for (const raw of text.split("\n")) {
    // Strip the focus marker before the ignore test (matching counts()), so an
    // ignore pattern matches regardless of focus, and focus never perturbs stop
    // positions, counts, or the still-on-page check — it's reported separately
    // via focusChange.
    const line = stripFocusMarker(raw.trim());
    if (line === "") continue;
    if (ignore?.(line)) continue;
    lines.push(line);
  }
  return lines;
}

/**
 * The focused node's `role "name"` descriptor in a serialized tree, or null
 * when nothing is marked. Read from the tree view — it carries every element,
 * unlike the outline (headings only) or tabs (focusables only).
 */
export function focusedDescriptor(
  rawTree: string,
  ignore: Ignore,
): string | null {
  for (const raw of rawTree.split("\n")) {
    const line = raw.trim();
    if (line === "" || !line.endsWith(" [focused]")) continue;
    // Test ignore on the stripped descriptor (matching counts()), so a line the
    // user ignored doesn't report a focus change either.
    const descriptor = stripFocusMarker(line);
    if (!ignore?.(descriptor)) return descriptor;
  }
  return null;
}

/**
 * The `focus-changed` statement, when the element focused at capture time
 * differs between base and PR — a moved autofocus target, or focus that
 * appeared/vanished. A pure focus move leaves no structural diff, so this is
 * the only signal that the keyboard entry point changed.
 */
export function focusChange(
  baseTree: string,
  prTree: string,
  ignore: Ignore,
): ViewChange | null {
  const from = focusedDescriptor(baseTree, ignore);
  const to = focusedDescriptor(prTree, ignore);
  if (from === to) return null;
  const message =
    from === null
      ? `Focus now starts on ${to} (nothing was focused before)`
      : to === null
        ? `Focus no longer starts anywhere (was ${from})`
        : `Focused element changed: ${from} → ${to}`;
  return {
    kind: "focus-changed",
    view: "tree",
    message,
    ...(from !== null ? { from } : {}),
    ...(to !== null ? { to } : {}),
  };
}

/** The tab-order sequence as stripped stop content (`NN.` counter removed,
 * sentinel and ignored lines dropped), in document order. */
export function tabStops(rawTabs: string, ignore: Ignore): string[] {
  const stops: string[] = [];
  for (const line of rawLines(rawTabs, ignore)) {
    if (line === NOTHING_FOCUSABLE) continue;
    stops.push(stripTabIndex(line));
  }
  return stops;
}

/** Position of a diffed stop in the sequence — its 1-based index, only when
 * the stripped line occurs exactly once (never guess among duplicates). The
 * index (not the line's own `NN.` counter) keeps `position ≤ of` even when
 * `--ignore-view-line` drops earlier stops from the sequence. */
export function findStop(
  stops: readonly string[],
  stripped: string,
): { position?: number; of: number } {
  let found = -1;
  for (let i = 0; i < stops.length; i++) {
    if (stops[i] !== stripped) continue;
    if (found !== -1) return { of: stops.length }; // duplicate — ambiguous
    found = i;
  }
  return found === -1
    ? { of: stops.length }
    : { position: found + 1, of: stops.length };
}

export function outlineHeadings(rawOutline: string, ignore: Ignore): string[] {
  return rawLines(rawOutline, ignore).filter((l) => l !== NO_HEADINGS);
}

/** How many tree lines match (role, name), level suffix ignored. */
export function countInTree(
  rawTree: string,
  ignore: Ignore,
  role: string,
  name: string,
): number {
  let count = 0;
  for (const line of rawLines(rawTree, ignore)) {
    const parsed = parseRoleLine(line);
    if (parsed.role === role && (parsed.name ?? "") === name) count++;
  }
  return count;
}

export function lcsLength(a: readonly string[], b: readonly string[]): number {
  // Two-row DP — lengths are bounded by REORDER_LCS_LIMIT.
  let prev = new Array<number>(b.length + 1).fill(0);
  let curr = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      curr[j] =
        a[i - 1] === b[j - 1]
          ? prev[j - 1] + 1
          : Math.max(prev[j], curr[j - 1]);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

export function sameMultiset(
  a: readonly string[],
  b: readonly string[],
): boolean {
  if (a.length !== b.length) return false;
  const ms = toMultiset(a);
  for (const line of b) if (take(ms, line) === 0) return false;
  return ms.size === 0;
}

// ── message helpers ──────────────────────────────────────────────────────────

export const plural = (n: number, word: string) =>
  `${n} ${word}${n === 1 ? "" : "s"}`;

/** `navigation "Footer"` | `banner (unnamed)` — landmarks. */
export const landmarkDesc = (role: string, name: string) =>
  name === "" ? `${role} (unnamed)` : `${role} "${name}"`;

/** `link "Docs"` | `button (no accessible name)` — stops + interactive. */
export const controlDesc = (role: string, name: string) =>
  name === "" ? `${role} (no accessible name)` : `${role} "${name}"`;

export const headingDesc = (name: string) =>
  name === "" ? "(unnamed heading)" : `"${name}"`;

export const nameDesc = (name: string) =>
  name === "" ? "(unnamed)" : `"${name}"`;

export const withCount = (message: string, n: number) =>
  n > 1 ? `${message} (×${n})` : message;
