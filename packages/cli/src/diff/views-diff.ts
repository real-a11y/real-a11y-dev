/**
 * Structural view diff — a normalized-line multiset diff of the serialized
 * tree / outline / tabs. Advisory only (it never gates); it answers "did the
 * structure change, review it" where the findings diff answers "did a NEW
 * violation appear".
 *
 * Multiset, not line-level: a re-indented or moved subtree shows only the lines
 * that actually appeared/vanished, not 20 "changed" lines. We do NOT strip the
 * `(level N)` suffix — that normalization is for custom-vs-native comparison;
 * here both sides carry it, and stripping would hide a real h2→h3 change.
 *
 * The `tabs` view is a NUMBERED list, so an inserted stop renumbers every stop
 * after it — 40 "changed" lines for one real insertion. `stripTabIndex` drops
 * the `NN.` prefix before comparison so the diff is the stop that actually
 * appeared/vanished. (This makes a pure REORDER invisible to the multiset — a
 * later order-aware pass surfaces "X now precedes Y"; here, unreadable churn was
 * no more actionable than nothing.)
 */

export interface ViewDiff {
  added: string[];
  removed: string[];
}

/** Drop the leading `NN. ` sequence number from a serialized tab-order line. */
export function stripTabIndex(line: string): string {
  return line.replace(/^\d+\.\s*/, "");
}

/** The trailing focus marker emitted by @real-a11y-dev/serialize (`markFocus`). */
const FOCUS_MARKER = " [focused]";

/**
 * Drop a trailing ` [focused]` marker. Focus is not structure — stripping it
 * before the multiset diff keeps a pure focus move (same elements, different
 * focused one) from surfacing as phantom add/remove churn. The transition is
 * reported separately as a `focus-changed` statement (see views-summary.ts).
 *
 * Tree/tabs names are quote-shielded (`role "name"`), so this is exact there.
 * Outline names are unquoted (`h2 name`), so a heading whose accessible name
 * literally ends in " [focused]" is ambiguous and can be over-stripped — a
 * negligible, non-occurring input; the equal-level / same-name guards in
 * summarizeViews keep it from producing a nonsensical statement.
 */
export function stripFocusMarker(line: string): string {
  return line.endsWith(FOCUS_MARKER)
    ? line.slice(0, -FOCUS_MARKER.length)
    : line;
}

function counts(
  text: string,
  normalize: (line: string) => string,
  ignore?: (trimmedLine: string) => boolean,
): Map<string, number> {
  const m = new Map<string, number>();
  for (const raw of text.split("\n")) {
    // Strip the focus marker FIRST — before the ignore test — so a user's
    // `--ignore-view-line` pattern matches a line identically whether or not it
    // is focused. Testing ignore on the marked line would let a transient
    // `[focused]` flip an end-anchored pattern and resurface an ignored,
    // focus-only change as phantom churn.
    const trimmed = stripFocusMarker(raw.trim());
    if (trimmed === "") continue;
    // Volatile-line filter (--ignore-view-line) — tested against the trimmed
    // line BEFORE normalize, and dropped before the multiset so counts,
    // statements, and raw arrays all agree.
    if (ignore?.(trimmed)) continue;
    const line = normalize(trimmed);
    if (line === "") continue;
    m.set(line, (m.get(line) ?? 0) + 1);
  }
  return m;
}

export function diffViews(
  base: string,
  pr: string,
  normalize: (line: string) => string = (l) => l,
  ignore?: (trimmedLine: string) => boolean,
): ViewDiff {
  const b = counts(base, normalize, ignore);
  const p = counts(pr, normalize, ignore);
  const added: string[] = [];
  const removed: string[] = [];
  for (const [line, n] of p) {
    const extra = n - (b.get(line) ?? 0);
    for (let i = 0; i < extra; i++) added.push(line);
  }
  for (const [line, n] of b) {
    const extra = n - (p.get(line) ?? 0);
    for (let i = 0; i < extra; i++) removed.push(line);
  }
  added.sort();
  removed.sort();
  return { added, removed };
}

export function viewDiffEmpty(diff: ViewDiff): boolean {
  return diff.added.length === 0 && diff.removed.length === 0;
}
