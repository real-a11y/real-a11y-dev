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

/** Collapse internal whitespace and trim: how every native transport
 *  compares a name's text. */
export function cleanAXText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Chromium's password mask: a value made only of these is a password field. */
const PASSWORD_MASK = /^[•●]+$/;

/**
 * `value` is Chromium's password mask — the AX value of a password field,
 * one bullet per character. Treat it as a sensitive field's whatever the
 * markup said by the time it was asked: the bullets' count is the
 * password's length.
 */
export function isNativePasswordMask(value: unknown): boolean {
  return (
    typeof value === "string" && PASSWORD_MASK.test(value.replace(/\s/g, ""))
  );
}

/**
 * `raw` is DOM-backed and holds a value, yet no in-page read classified it
 * (`classified` false) — a node the page added between the two reads, or one
 * the transport never asked about. Unclassified is withheld, for its value
 * and for every name built from it.
 */
export function holdsUnclassifiedValue(
  raw: RawAXNameNode,
  classified: boolean,
): boolean {
  return (
    !classified &&
    typeof raw.backendDOMNodeId === "number" &&
    carriesAXValue(raw)
  );
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

/**
 * A CDP value, as text. Chromium keeps range values as 32-bit floats, so a
 * `<meter value="0.6">` arrives as `0.6000000238418579`; print the shortest
 * decimal that is the same float, which is what the page wrote.
 */
function axValueText(value: unknown): string | undefined {
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

export function nativeAXProperty(
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
      cleanAXText(String(cur.name?.value ?? "")) !== ""
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
export interface NativeAXIndex<T extends RawAXNameNode = RawAXNameNode> {
  byId: ReadonlyMap<string, T>;
  byBackendId: ReadonlyMap<number, T>;
}

export function indexNativeAX<T extends RawAXNameNode>(
  rawNodes: T[],
): NativeAXIndex<T> {
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
  index: NativeAXIndex<T>,
  roots: ReadonlySet<string>,
): ValueRegions {
  const { byId, byBackendId } = index;
  const containing = new Set<string>();
  const rootsUnder = new Map<string, string[]>();
  for (const id of roots) {
    for (const cur of nativeAncestry(byId.get(id), byId)) {
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
    for (const cur of nativeAncestry(raw as T, byId)) {
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
    for (const cur of nativeAncestry(byId.get(root), byId)) {
      if (cur.nodeId === raw.nodeId) return true;
    }
    return false;
  };

  return {
    roots,
    containing,
    inside: (raw) => rootOf(raw) !== null,
    references: (raw, property) =>
      (nativeAXProperty(raw, property)?.relatedNodes ?? []).some((related) => {
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
      s.superseded !== true && cleanAXText(String(s.value?.value ?? "")) !== "",
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
 *   description is dropped whole. That costs any other text it held
 *   (`aria-describedby="hint card"` loses the hint too) and leaves no marker
 *   that anything was removed: Chromium sends no trace of which part of a
 *   description came from which node, so there is nothing to cut it at.
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
    if (cleanAXText(String(raw.name?.value ?? "")) !== "") {
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
 * `standIns` are the raw ids of the nodes standing in for such a field that
 * has no node of its own in the tree ({@link fieldStandIns}), which already
 * give its value away.
 */
export function withholdSensitiveFieldNames<T extends RawAXNameNode>(
  rawNodes: T[],
  fieldIds: Iterable<string>,
  standIns: Iterable<string> = [],
): T[] {
  const index = indexNativeAX(rawNodes);
  const roots = new Set<string>();
  for (const id of fieldIds) {
    const field = index.byId.get(id);
    if (field && givesValueAway(field, index.byId)) roots.add(id);
  }
  for (const id of standIns) {
    if (index.byId.has(id)) roots.add(id);
  }
  return withholdRegionNames(rawNodes, valueRegions(index, roots));
}

/** The elements that draw what they hold in their own user-agent shadow root. */
const FIELD_HOSTS: ReadonlySet<string> = new Set([
  "input",
  "textarea",
  "select",
]);

/**
 * Whether a shadow root, hosted by an element named `hostName`, is a form
 * control's own internals: the user-agent root of an `<input>`, `<textarea>`
 * or `<select>`, where it draws what it holds. Every native transport's DOM
 * walk marks the nodes below one ({@link FieldHostOf}), by this one rule.
 */
export function opensFieldInternals(
  hostName: string | undefined,
  shadowRootType: string | undefined,
): boolean {
  return (
    shadowRootType === "user-agent" &&
    FIELD_HOSTS.has((hostName ?? "").toLowerCase())
  );
}

/**
 * What a transport's walk of the document found of a DOM node, by backend
 * id: the backend id of the form control whose own internals hold it
 * ({@link opensFieldInternals}), `null` for a node it found anywhere else, or
 * `undefined` for one it never saw (the page changed between the two reads).
 */
export type FieldHostOf = (
  backendDOMNodeId: number,
) => number | null | undefined;

/** A `<div>` to Chromium: an unignored `generic` with no name and no value. */
function isBareGeneric(raw: RawAXNameNode | undefined): boolean {
  return (
    raw?.role?.value === "generic" &&
    !raw.ignored &&
    cleanAXText(String(raw.name?.value ?? "")) === "" &&
    !carriesAXValue(raw)
  );
}

/** `raw` is a text run with text. */
function isTextRun(raw: RawAXNameNode | undefined): boolean {
  return (
    raw?.role?.value === "StaticText" &&
    cleanAXText(String(raw.name?.value ?? "")) !== ""
  );
}

/**
 * Copies of `rawNodes` with no text from inside a form control. A text field,
 * a text area or a date input draws what it holds in its own user-agent shadow
 * root, and Chromium hangs that text on `StaticText` nodes there. The field's
 * own node owns them, so they never name anything, until a `role="none"` or
 * `"presentation"` on a disabled control takes the field's node out of the
 * tree. Its inner text box is then a bare `generic` holding the value, which
 * looks to {@link normalizeNativeAX} like any `<div>` of text: kept beside
 * other content and named after the card number, or promoted into the name of
 * the list item around it. Nothing in the AX tree tells the two apart, so the
 * transport reads it off the document ({@link FieldHostOf}).
 *
 * Every text run that is, or sits below an AX node that is, in a control's
 * internals loses its name. So does one a bare `generic` the walk never saw
 * holds directly: it may be a field's inner box the page put in after the
 * walk, and failing closed costs that block's text for one read. With no walk
 * at all (`hostOf` itself `undefined`), every text run a bare `generic` holds
 * directly loses its name, which takes in every field's inner box at the cost
 * of the page's own blocks of text.
 *
 * Returns copies; never mutates.
 */
export function withholdFieldInternalText<T extends RawAXNameNode>(
  rawNodes: T[],
  hostOf: FieldHostOf | undefined,
): T[] {
  const byId = new Map(rawNodes.map((raw) => [raw.nodeId, raw]));
  // nodeId → whether it or an AX ancestor is a field's internals. Memoized
  // along each walk, as in `valueRegions`.
  const memo = new Map<string, boolean>();
  const insideField = (raw: T): boolean => {
    const chain: string[] = [];
    let result = false;
    for (const cur of nativeAncestry(raw, byId)) {
      const known = memo.get(cur.nodeId);
      if (known !== undefined) {
        result = known;
        break;
      }
      chain.push(cur.nodeId);
      if (
        typeof cur.backendDOMNodeId === "number" &&
        typeof hostOf?.(cur.backendDOMNodeId) === "number"
      ) {
        result = true;
        break;
      }
    }
    for (const id of chain) memo.set(id, result);
    return result;
  };
  const withheld = (raw: T): boolean => {
    const parent = raw.parentId ? byId.get(raw.parentId) : undefined;
    const inBareGeneric = isBareGeneric(parent);
    if (hostOf === undefined) return inBareGeneric;
    if (insideField(raw)) return true;
    return (
      inBareGeneric &&
      typeof parent?.backendDOMNodeId === "number" &&
      hostOf(parent.backendDOMNodeId) === undefined
    );
  };

  let changed = false;
  const out = rawNodes.map((raw) => {
    if (!isTextRun(raw) || !withheld(raw)) return raw;
    changed = true;
    return { ...raw, name: { value: "" } };
  });
  return changed ? out : rawNodes;
}

/**
 * A form control the tree has no node of its own for, and the nodes standing
 * in for it there ({@link fieldStandIns}). `host` is the control's backend id,
 * `undefined` when the walk can't say whether any control is behind them.
 */
export interface FieldStandIn {
  host: number | undefined;
  nodeIds: string[];
}

/**
 * The nodes to withhold a form control's value by when the tree has no node
 * of the control's own to withhold it by. A `role="none"` or `"presentation"`
 * on a disabled control takes its node out of Chromium's tree, or leaves it
 * ignored, and leaves its internals: the inner box holding a text field's
 * value, a month input's spinbuttons. Chromium still builds names from content
 * that include them, so `<td><input disabled role="none"
 * autocomplete="cc-number" value="4111…"></td>` reads `cell "4111…"`, and a
 * card-expiry month input's spinbuttons announce its parts. The policy keys on
 * the control's node and finds nothing. The transport classifies the control
 * (`host`) as it does any field, and when it counts, makes the stand-ins value
 * roots ({@link valueRegions}).
 *
 * Per control with no unignored node of its own, its stand-ins are the topmost
 * of its internals in the tree. They count when they hold a value or a text
 * run with text ({@link holdsContent}), which is what Chromium builds a name
 * from. An empty field gives nothing away, nor does its placeholder, which
 * Chromium ignores beside the empty box. A field whose internals Chromium
 * ignores whole, as for an `aria-hidden` one, keeps an ignored node of its own,
 * which the transport classifies as any field ({@link givesValueAway}).
 *
 * With `host` `undefined`, each bare `generic` that holds a text run directly
 * and that the walk never saw stands in for a control the walk can't name, as
 * {@link withholdFieldInternalText} blanks its text: it may be a control's
 * inner box. So does every such `generic` with no walk at all (`hostOf`
 * itself `undefined`). Failing closed costs the names built around them for
 * one read. One inside a node that carries a value or is editable is that
 * field's own, and the field's node stands for it.
 */
export function fieldStandIns<T extends RawAXNameNode>(
  index: NativeAXIndex<T>,
  hostOf: FieldHostOf | undefined,
): FieldStandIn[] {
  const { byId, byBackendId } = index;
  const hostOfNode = (raw: T | undefined): number | null | undefined =>
    typeof raw?.backendDOMNodeId === "number"
      ? hostOf?.(raw.backendDOMNodeId)
      : null;
  // A node around `raw` is a field: it carries a value, or is editable.
  const inField = (raw: T): boolean => {
    for (const cur of nativeAncestry(raw, byId)) {
      if (
        cur !== raw &&
        (carriesAXValue(cur) ||
          (cur.properties ?? []).some((p) => p.name === "editable"))
      ) {
        return true;
      }
    }
    return false;
  };
  const topmost = new Map<number, T[]>();
  const out: FieldStandIn[] = [];
  for (const raw of byId.values()) {
    const host = hostOfNode(raw);
    if (typeof host === "number") {
      const parent = raw.parentId ? byId.get(raw.parentId) : undefined;
      if (hostOfNode(parent) === host) continue;
      const own = byBackendId.get(host);
      if (own !== undefined && own.ignored !== true) continue;
      const tops = topmost.get(host);
      if (tops) tops.push(raw);
      else topmost.set(host, [raw]);
    } else if (
      host === undefined &&
      isBareGeneric(raw) &&
      (raw.childIds ?? []).some((id) => isTextRun(byId.get(id))) &&
      !inField(raw)
    ) {
      out.push({ host: undefined, nodeIds: [raw.nodeId] });
    }
  }
  for (const [host, tops] of topmost) {
    if (tops.some((top) => holdsContent(top, byId, true))) {
      out.push({ host, nodeIds: tops.map((top) => top.nodeId) });
    }
  }
  return out;
}
