/**
 * Where a withheld field's value reaches a NAME or a description in
 * Chromium's native tree, and the rule that keeps it out (ADR-0001).
 *
 * A sensitive field's own value is withheld by each producer, but Chromium
 * also copies field values into other nodes' names on its own: a cell, a link
 * or a `<label>`-wrapped checkbox is named from its contents, and an embedded
 * field's value is part of them (`<td><input autocomplete="cc-number"></td>`
 * is `cell "4111…"`). That rule is the same whatever transport read the tree,
 * so it lives here, beside {@link normalizeNativeAX}: `@real-a11y-dev/browser`
 * and the extension's debugger mode each decide WHICH fields are sensitive,
 * from what they can see, and hand the raw node ids here before normalizing.
 *
 * Pure: raw CDP nodes in, copies out. No DOM, no transport.
 *
 * @internal
 */

import { REDACTED_VALUE } from "../extraction/dom-extractor.js";

import type { RawNativeAXNode } from "./ax-normalize.js";
import { NATIVE_AX_NAME_SOURCE_ROLES } from "./ax-vocabulary.js";

/** One step of Chromium's accessible-name computation, as `getFullAXTree`
 *  reports it on `name.sources`, in accname order. */
export interface AXNameSource {
  type?: string;
  attribute?: string;
  value?: { value?: unknown };
  superseded?: boolean;
}

/** A CDP `AXValue` on a property; `relatedNodes` for idref ones
 *  (`labelledby`, `describedby`). */
export interface AXPropertyValue {
  type?: string;
  value?: unknown;
  relatedNodes?: Array<{ backendDOMNodeId?: number }>;
}

/** The CDP `Accessibility.AXNode` fields the name rule reads — a superset of
 *  {@link RawNativeAXNode}. */
export interface RawAXNameNode extends RawNativeAXNode {
  /** `sources` is Chromium's accname trace — see {@link winningNameSource}. */
  name?: { value?: string; sources?: AXNameSource[] };
  description?: { value?: string };
  properties?: Array<{ name: string; value?: AXPropertyValue }>;
}

function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Walk `raw` and its ancestors by `parentId`, stopping on a cycle. */
export function* ancestry<T extends RawAXNameNode>(
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

/**
 * A CDP value, as text. Chromium keeps range values as 32-bit floats, so a
 * `<meter value="0.6">` arrives as `0.6000000238418579`; print the shortest
 * decimal that is the same float, which is what the page wrote.
 */
export function axValueText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (Math.fround(value) === value) {
    for (let digits = 1; digits <= 9; digits++) {
      const shortest = Number(value.toPrecision(digits));
      if (Math.fround(shortest) === value) return String(shortest);
    }
  }
  return String(value);
}

export function propertyOf(
  raw: RawAXNameNode,
  name: string,
): AXPropertyValue | undefined {
  return raw.properties?.find((p) => p.name === name)?.value;
}

/** A value with text that isn't only whitespace, as text; else `undefined`. */
export function nonEmptyAXText(value: unknown): string | undefined {
  const text = axValueText(value);
  return text !== undefined && text.trim() !== "" ? text : undefined;
}

/** `raw` has an AX value with text in it. */
export function carriesAXValue(raw: RawAXNameNode): boolean {
  return nonEmptyAXText(raw.value?.value) !== undefined;
}

/**
 * True when `raw` or anything beneath it holds content a name could borrow: a
 * value (a filled field, or a card-expiry input's month and year parts), and
 * with `text`, a text run that has text (what was typed into an editor). A
 * placeholder isn't content — a native field's is never counted, since only
 * values are for one. An EMPTY field or editor contributes nothing to a name
 * built around it, so it must not withhold one (a cell labelled "Card number"
 * around an empty card field keeps its name).
 */
export function holdsContent<T extends RawAXNameNode>(
  raw: T,
  byId: ReadonlyMap<string, T>,
  text: boolean,
): boolean {
  const stack = [raw];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (seen.has(cur.nodeId)) continue;
    seen.add(cur.nodeId);
    if (carriesAXValue(cur)) return true;
    if (
      text &&
      NATIVE_AX_NAME_SOURCE_ROLES.has(cur.role?.value ?? "") &&
      cleanText(String(cur.name?.value ?? "")) !== ""
    ) {
      return true;
    }
    for (const id of cur.childIds ?? []) {
      const child = byId.get(id);
      if (child) stack.push(child);
    }
  }
  return false;
}

/** The raw nodes, indexed the two ways the classifiers look them up. */
export interface RawIndex<T extends RawAXNameNode = RawAXNameNode> {
  byId: ReadonlyMap<string, T>;
  byBackendId: ReadonlyMap<number, T>;
}

export function indexRaw<T extends RawAXNameNode>(rawNodes: T[]): RawIndex<T> {
  const byId = new Map<string, T>();
  const byBackendId = new Map<number, T>();
  for (const raw of rawNodes) {
    byId.set(raw.nodeId, raw);
    if (typeof raw.backendDOMNodeId === "number") {
      byBackendId.set(raw.backendDOMNodeId, raw);
    }
  }
  return { byId, byBackendId };
}

/**
 * A set of fields whose values are withheld ("roots"), and every place
 * Chromium carries those values besides the field itself.
 */
export interface ValueRegions {
  roots: ReadonlySet<string>;
  /** Raw ids of the strict AX ancestors of a root. */
  containing: ReadonlySet<string>;
  /** `raw` is a root or sits inside one. */
  inside(raw: RawAXNameNode): boolean;
  /**
   * `raw` takes its label or description by reference — `aria-labelledby` /
   * `aria-describedby`, and the `labelledby` Chromium reports for a `<label>` —
   * from a root other than its own: the referenced node is, is inside, or
   * contains one. A field wrapped in its own `<label>` references that label,
   * but the label's only root is the field itself, whose value never names
   * it; that is no reference to a value.
   */
  references(
    raw: RawAXNameNode,
    property: "labelledby" | "describedby",
  ): boolean;
}

export function valueRegions<T extends RawAXNameNode>(
  index: RawIndex<T>,
  roots: ReadonlySet<string>,
): ValueRegions {
  const { byId, byBackendId } = index;
  const containing = new Set<string>();
  const rootsUnder = new Map<string, string[]>();
  for (const id of roots) {
    for (const cur of ancestry(byId.get(id), byId)) {
      if (cur.nodeId === id) continue;
      containing.add(cur.nodeId);
      const under = rootsUnder.get(cur.nodeId);
      if (under) under.push(id);
      else rootsUnder.set(cur.nodeId, [id]);
    }
  }

  // nodeId → the nearest root at or above it, or null. Memoized along each
  // walk, so classifying every node costs one pass, not one per depth.
  const rootMemo = new Map<string, string | null>();
  const rootOf = (raw: RawAXNameNode): string | null => {
    const chain: string[] = [];
    let result: string | null = null;
    for (const cur of ancestry(raw as T, byId)) {
      const known = rootMemo.get(cur.nodeId);
      if (known !== undefined) {
        result = known;
        break;
      }
      chain.push(cur.nodeId);
      if (roots.has(cur.nodeId)) {
        result = cur.nodeId;
        break;
      }
    }
    for (const id of chain) rootMemo.set(id, result);
    return result;
  };

  /**
   * `root` is part of `raw` itself: `raw` is a field (a root) and `root` is
   * it or sits inside it — a date input's own spinbuttons. A field's name
   * never includes its own value, so its own label pointing back around it
   * carries nothing. A node that is NOT a field — a region labelled by the
   * editable heading inside it — gets no such pass: its name IS the text.
   */
  const ownRoot = (root: string, raw: RawAXNameNode): boolean => {
    if (!roots.has(raw.nodeId)) return false;
    for (const cur of ancestry(byId.get(root), byId)) {
      if (cur.nodeId === raw.nodeId) return true;
    }
    return false;
  };

  return {
    roots,
    containing,
    inside: (raw) => rootOf(raw) !== null,
    references: (raw, property) =>
      (propertyOf(raw, property)?.relatedNodes ?? []).some((related) => {
        const target =
          typeof related.backendDOMNodeId === "number"
            ? byBackendId.get(related.backendDOMNodeId)
            : undefined;
        if (target === undefined) return false;
        const around = rootOf(target);
        const reached = [
          ...(around !== null ? [around] : []),
          ...(rootsUnder.get(target.nodeId) ?? []),
        ];
        return reached.some((root) => !ownRoot(root, raw));
      }),
  };
}

/** The step of Chromium's name trace that produced `raw`'s name: the first
 *  one with text that wasn't superseded. */
export function winningNameSource(
  raw: RawAXNameNode,
): AXNameSource | undefined {
  return raw.name?.sources?.find(
    (s) =>
      s.superseded !== true && cleanText(String(s.value?.value ?? "")) !== "",
  );
}

/**
 * Keep the roots' values out of every NAME and description, where Chromium
 * puts them on its own:
 *
 * - **Named from contents.** Chromium names a cell, a link or a button from
 *   its contents, and an embedded field's value is part of them:
 *   `<td><input autocomplete="cc-number"></td>` is `cell "4111…"`, and a
 *   password field in a cell is `cell "••••••••"`. A node that CONTAINS a root
 *   and was named from its contents reads `[redacted]` (a text run is blanked
 *   instead, so no promotion can carry it); so does one whose name trace is
 *   missing or has no winning step, since nothing then says where the name
 *   came from. A root named from its own contents reads `[redacted]` too. A
 *   name from anywhere else — `aria-label`, a `<legend>`, a `<label for>` — is
 *   the page's and is kept, and so is a root's own name with no trace (how a
 *   field's label arrives in an older recording; a field is never named after
 *   its own value).
 * - **Named or described by reference** to a root that isn't the node's own
 *   ({@link ValueRegions.references}). Such a name reads `[redacted]`; such a
 *   description is dropped.
 *
 * Returns copies; never mutates.
 */
export function withholdRegionNames<T extends RawAXNameNode>(
  rawNodes: T[],
  regions: ValueRegions,
): T[] {
  if (regions.roots.size === 0) return rawNodes;
  return rawNodes.map((raw) => {
    let out = raw;
    if (cleanText(String(raw.name?.value ?? "")) !== "") {
      const winner = winningNameSource(raw);
      const redact =
        (regions.containing.has(raw.nodeId) &&
          (winner === undefined || winner.type === "contents")) ||
        (regions.roots.has(raw.nodeId) && winner?.type === "contents") ||
        regions.references(raw, "labelledby");
      if (redact) {
        const textRun = NATIVE_AX_NAME_SOURCE_ROLES.has(raw.role?.value ?? "");
        out = { ...out, name: { value: textRun ? "" : REDACTED_VALUE } };
      }
    }
    if (raw.description?.value && regions.references(raw, "describedby")) {
      const { description: _dropped, ...rest } = out;
      out = rest as T;
    }
    return out;
  });
}

/**
 * Whether a sensitive field can give its value away to a name around it. A
 * field that holds something can ({@link holdsContent}); an empty one has
 * nothing to give. A field Chromium IGNORES can too, whatever it holds:
 * Chromium sends no value for it, so emptiness can't be told, yet
 * `aria-labelledby` still reads it — an `aria-hidden` card input names the
 * region labelled by it after the card.
 */
export function givesValueAway<T extends RawAXNameNode>(
  field: T,
  byId: ReadonlyMap<string, T>,
): boolean {
  return field.ignored === true || holdsContent(field, byId, false);
}

/**
 * {@link withholdRegionNames} for a producer's sensitive fields: `fieldIds` are
 * the raw ids of the fields it classified as sensitive (or could not
 * classify). Only a field that {@link givesValueAway} withholds names.
 */
export function withholdSensitiveFieldNames<T extends RawAXNameNode>(
  rawNodes: T[],
  fieldIds: Iterable<string>,
): T[] {
  const index = indexRaw(rawNodes);
  const roots = new Set<string>();
  for (const id of fieldIds) {
    const field = index.byId.get(id);
    if (field && givesValueAway(field, index.byId)) roots.add(id);
  }
  return withholdRegionNames(rawNodes, valueRegions(index, roots));
}
