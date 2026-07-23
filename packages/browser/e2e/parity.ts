/**
 * DOM↔native parity metric for the corpus harness.
 *
 * Both producers serialize to the same indented `role "name"` shape, so we
 * compare them as order-insensitive multisets of `role "name"` pairs. The two
 * producers will never be byte-identical (Chromium vocabulary — file-input as
 * `button`, `<details>` as disclosure, name-placement differences — plus the
 * UA-shadow media controls only native can see), so the metric is *overlap*,
 * not equality: `shared / domCount`, the same number the RFC's Spike 4
 * reported (~89%). Divergences are a two-way signal (DOM-producer gaps AND
 * native-normalizer bugs), which is the point of running it in CI.
 */

/** One serialized line reduced to `role "name"` (or bare `role`). */
export function normalizePair(line: string): string {
  const m = line.trim().match(/^(\S+)(?:\s+"(.*)")?(?:\s+\(.*\))?$/);
  if (!m) return line.replace(/\s+/g, " ").trim();
  const role = m[1].toLowerCase();
  const name = (m[2] ?? "").replace(/\s+/g, " ").trim();
  return name ? `${role} "${name}"` : role;
}

export function toPairs(serialized: string): string[] {
  return serialized
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map(normalizePair);
}

function multiset(items: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const i of items) m.set(i, (m.get(i) ?? 0) + 1);
  return m;
}

export interface ParityReport {
  domCount: number;
  nativeCount: number;
  shared: number;
  onlyDom: string[];
  onlyNative: string[];
  /** `shared / domCount` — the fraction of the DOM tree the native tree covers. */
  overlap: number;
}

export function computeParity(
  domTree: string,
  nativeTree: string,
): ParityReport {
  const dom = multiset(toPairs(domTree));
  const native = multiset(toPairs(nativeTree));

  let shared = 0;
  const onlyDom: string[] = [];
  const onlyNative: string[] = [];
  for (const key of new Set([...dom.keys(), ...native.keys()])) {
    const d = dom.get(key) ?? 0;
    const n = native.get(key) ?? 0;
    shared += Math.min(d, n);
    for (let i = 0; i < d - n; i++) onlyDom.push(key);
    for (let i = 0; i < n - d; i++) onlyNative.push(key);
  }

  const domCount = [...dom.values()].reduce((a, b) => a + b, 0);
  const nativeCount = [...native.values()].reduce((a, b) => a + b, 0);
  return {
    domCount,
    nativeCount,
    shared,
    onlyDom: onlyDom.sort(),
    onlyNative: onlyNative.sort(),
    overlap: domCount === 0 ? 0 : shared / domCount,
  };
}
