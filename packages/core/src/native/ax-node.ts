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

import type {
  AXPropertyValue,
  NativeAXIndex,
  RawAXNameNode,
} from "./value-regions.js";

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

/**
 * The relations by which a field reaches a popup that is not its descendant:
 * Chromium's resolution of `aria-controls` and `aria-owns`. Chromium leaves an
 * `aria-owns` target where it is when the owner is an `<input>` (measured,
 * Chromium 141), so owning is not always structure in the tree it sends; it
 * also reports a combobox's owned listbox as `controls`.
 */
const FIELD_RELATIONS: ReadonlySet<string> = new Set(["controls", "owns"]);

/**
 * What `field` controls or owns, by Chromium's resolution: the raw nodes its
 * `controls` and `owns` relations name. An ARIA combobox's popup listbox is
 * not the field's descendant, yet the option it marks selected is the field's
 * value. The one rule both native transports reach a sensitive field's popup
 * by, so the two can't drift: the browser package's `withholdSelection`
 * withholds everything under these ({@link fieldRelationTargets}), and the
 * extension's `controlledRegion` follows them down to the nodes its tree kept.
 * The DOM producer's counterpart is `inSensitiveChoice`.
 */
export function fieldRelationRoots<T extends RawAXNameNode>(
  index: NativeAXIndex<T>,
  field: T,
): T[] {
  const roots: T[] = [];
  for (const property of field.properties ?? []) {
    if (!FIELD_RELATIONS.has(property.name)) continue;
    for (const related of property.value?.relatedNodes ?? []) {
      const target =
        typeof related.backendDOMNodeId === "number"
          ? index.byBackendId.get(related.backendDOMNodeId)
          : undefined;
      if (target && !roots.includes(target)) roots.push(target);
    }
  }
  return roots;
}

/** Every raw node at or under {@link fieldRelationRoots}. */
export function fieldRelationTargets<T extends RawAXNameNode>(
  index: NativeAXIndex<T>,
  field: T,
): T[] {
  const stack = fieldRelationRoots(index, field);
  const out: T[] = [];
  const seen = new Set<T>();
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (seen.has(node)) continue;
    seen.add(node);
    out.push(node);
    for (const childId of node.childIds ?? []) {
      const child = index.byId.get(childId);
      if (child) stack.push(child);
    }
  }
  return out;
}

/**
 * The nodes whose relations reach a sensitive field's popup: each field in
 * `fieldIds`, and each combobox around one. That is the ARIA 1.1 pattern, a
 * `role="combobox"` wrapper that carries `aria-controls` or `aria-owns` for
 * the field inside it, whose own relations are empty. The DOM producer's
 * counterpart is core's `isSensitiveChoiceHost`.
 */
export function sensitiveChoiceHosts<T extends RawAXNameNode>(
  byId: ReadonlyMap<string, T>,
  fieldIds: Iterable<string>,
): T[] {
  const hosts = new Set<T>();
  for (const id of fieldIds) {
    for (const node of nativeAncestry(byId.get(id), byId)) {
      if (node.nodeId === id || node.role?.value === "combobox") {
        hosts.add(node);
      }
    }
  }
  return [...hosts];
}
