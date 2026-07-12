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

function counts(
  text: string,
  normalize: (line: string) => string,
  ignore?: (trimmedLine: string) => boolean,
): Map<string, number> {
  const m = new Map<string, number>();
  for (const raw of text.split("\n")) {
    const trimmed = raw.trim();
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
