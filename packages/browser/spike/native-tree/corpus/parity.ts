/**
 * SPIKE — DOM↔native parity helpers for a real-app HTML/ARIA corpus.
 *
 * Compares role+"name" multisets (order-insensitive) so structure noise and
 * child-order differences under media don't dominate the signal. Also lists
 * roles present only on one side.
 */

export type Pair = string; // `role "name"` or `role`

export function parsePairs(serialized: string): Pair[] {
  return serialized
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.replace(/^\d+\.\s+/, "")); // tab-sequence style, if any
}

/** Normalize pair text for comparison (collapse whitespace, lowercase role). */
export function normalizePair(pair: Pair): string {
  const m = pair.match(/^(\S+)(?:\s+"(.*)")?(?:\s+\(.*\))?$/);
  if (!m) return pair.replace(/\s+/g, " ").trim();
  const role = m[1].toLowerCase();
  const name = (m[2] ?? "").replace(/\s+/g, " ").trim();
  return name ? `${role} "${name}"` : role;
}

export interface ParityReport {
  onlyNative: string[];
  onlyDom: string[];
  shared: string[];
  nativeCount: number;
  domCount: number;
}

export function diffPairs(nativeTree: string, domTree: string): ParityReport {
  const native = multiset(parsePairs(nativeTree).map(normalizePair));
  const dom = multiset(parsePairs(domTree).map(normalizePair));

  const onlyNative: string[] = [];
  const onlyDom: string[] = [];
  const shared: string[] = [];

  const keys = new Set([...native.keys(), ...dom.keys()]);
  for (const key of [...keys].sort()) {
    const n = native.get(key) ?? 0;
    const d = dom.get(key) ?? 0;
    const both = Math.min(n, d);
    for (let i = 0; i < both; i++) shared.push(key);
    for (let i = 0; i < n - d; i++) onlyNative.push(key);
    for (let i = 0; i < d - n; i++) onlyDom.push(key);
  }

  return {
    onlyNative,
    onlyDom,
    shared,
    nativeCount: [...native.values()].reduce((a, b) => a + b, 0),
    domCount: [...dom.values()].reduce((a, b) => a + b, 0),
  };
}

function multiset(items: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const i of items) m.set(i, (m.get(i) ?? 0) + 1);
  return m;
}

/** Roles we expect on *both* sides for a healthy corpus (not media-only). */
export const EXPECTED_SHARED_ROLE_PREFIXES = [
  "banner",
  "navigation",
  "main",
  "contentinfo",
  "heading",
  "button",
  "link",
  "textbox",
  "radio",
  "checkbox",
  "combobox", // <select> often
  "list",
  "listitem",
  "table", // or grid depending on engine
  "img",
  "tab",
  "tablist",
  "switch",
  "progressbar",
  "alert",
] as const;
