/**
 * Reading Chromium's raw accessibility nodes: the few primitives both the
 * value-region rules ({@link valueRegions}) and the label rules
 * ({@link labelLending}) walk the tree with. Kept apart so neither module
 * imports the other's code.
 *
 * Pure. No DOM, no transport.
 *
 * @internal
 */

import { trimAscii } from "../utils/ascii-whitespace.js";

import type { AXPropertyValue, RawAXNameNode } from "./value-regions.js";

/**
 * True when `text` holds more than ASCII whitespace. A U+00A0 is text, as a
 * name keeps it (#639), and an editor writes a typed space as one: an editor
 * holding nothing else has something typed, and a name of nothing else
 * still shows it. What the redaction rules ask, where {@link cleanAXText}
 * would call such text empty.
 */
export function hasAXText(text: string): boolean {
  return trimAscii(text) !== "";
}

/** Walk `raw` and its ancestors by `parentId`, stopping on a cycle. */
export function* nativeAncestry<T extends RawAXNameNode>(
  raw: T | undefined,
  byId: ReadonlyMap<string, T>,
): Generator<T> {
  const seen = new Set<string>();
  for (
    let cur = raw;
    cur && !seen.has(cur.nodeId);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined
  ) {
    seen.add(cur.nodeId);
    yield cur;
  }
}

export function nativeAXProperty(
  raw: RawAXNameNode,
  name: string,
): AXPropertyValue | undefined {
  return raw.properties?.find((p) => p.name === name)?.value;
}
