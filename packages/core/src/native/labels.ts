/**
 * A form control's `<label>`s, and the withheld values Chromium reads into a
 * name through them (ADR-0001).
 *
 * Wherever Chromium reads a control into another node's name — a reference
 * to it, a label around it, content named around it — and the control has no
 * value of its own to lend, it reads the control's `<label>`s instead, and an
 * embedded field's value in one with them: `<label for="c">Code <input
 * autocomplete="one-time-code" value="482913"></label><input type="checkbox"
 * id="c">` makes `<button aria-labelledby="c">` `button "Code 482913"`.
 * {@link labelLending} finds the controls that lend a withheld value that way,
 * for {@link valueRegions}. Chromium's tree says which labels a control has in
 * the control's own name trace, but a hidden control keeps only an ignored
 * node there, with no trace at all, so the transport's walk of the document
 * says it instead ({@link domLabels}).
 *
 * Pure: raw CDP nodes or a DOM tree in, sets and maps out. No transport.
 *
 * @internal
 */

import { trimAscii } from "../utils/ascii-whitespace.js";

import { hasAXText, nativeAncestry, nativeAXProperty } from "./ax-node.js";
import type {
  AXPropertyValue,
  NativeAXIndex,
  RawAXNameNode,
} from "./value-regions.js";

// ── The document's labels ───────────────────────────────────────────────────

/** The fields of a CDP `DOM.Node` that {@link domLabels} reads. Both the
 *  nested `DOM.getDocument` tree and a rebuilt `DOM.getFlattenedDocument`
 *  one have them. */
export interface LabelDomNode {
  backendNodeId?: number;
  nodeType?: number;
  nodeName?: string;
  localName?: string;
  /** Flat: `[name, value, name, value, …]`. */
  attributes?: string[];
  children?: LabelDomNode[];
  shadowRoots?: LabelDomNode[];
  /** On a shadow root: `open`, `closed` or `user-agent`. */
  shadowRootType?: string;
  contentDocument?: LabelDomNode;
}

/**
 * What a transport's walk of the document found of the labels Chromium reads
 * for a DOM node, by backend id: its labels' backend ids ({@link domLabels}),
 * none for a node with no label, or `undefined` for one the walk never saw
 * (the page changed between the two reads).
 */
export type LabelsOf = (
  backendDOMNodeId: number,
) => readonly number[] | undefined;

/** HTML's labelable elements; an `<input type="hidden">` is not one. */
const LABELABLE: ReadonlySet<string> = new Set([
  "button",
  "input",
  "meter",
  "output",
  "progress",
  "select",
  "textarea",
]);

function attributeOf(node: LabelDomNode, name: string): string | undefined {
  const attributes = node.attributes ?? [];
  for (let i = 0; i + 1 < attributes.length; i += 2) {
    if (attributes[i] === name) return attributes[i + 1];
  }
  return undefined;
}

function isLabelable(tag: string, node: LabelDomNode): boolean {
  if (tag === "input") {
    return attributeOf(node, "type")?.toLowerCase() !== "hidden";
  }
  return LABELABLE.has(tag);
}

/** One wrapping `<label>` the walk is inside, until it finds its control. */
interface OpenLabel {
  label: number;
  found: boolean;
}

/** What the walk gathers, across every tree it reads. */
interface Walk {
  labels: Map<number, number[]>;
  /** The elements whose `aria-label` has text. */
  named: Set<number>;
  seen: Set<number>;
}

/** What reading one tree (a document or a shadow root) keeps track of. */
interface TreeRead {
  /** Each id's first element, as `getElementById` finds it. */
  byId: Map<string, number>;
  forLabels: Array<[label: number, id: string]>;
  /** The wrapping labels around the node being read, innermost last. */
  open: OpenLabel[];
  walk: Walk;
}

function addLabel(walk: Walk, control: number, label: number): void {
  const known = walk.labels.get(control);
  if (!known) walk.labels.set(control, [label]);
  else if (!known.includes(label)) known.push(label);
}

/** Read one element of a tree; the wrapping `<label>` it opens, if it is one. */
function readElement(
  node: LabelDomNode,
  element: number,
  read: TreeRead,
): OpenLabel | undefined {
  read.walk.seen.add(element);
  const tag = (node.localName ?? node.nodeName ?? "").toLowerCase();
  const id = attributeOf(node, "id");
  if (id && !read.byId.has(id)) read.byId.set(id, element);
  if (trimAscii(attributeOf(node, "aria-label") ?? "") !== "") {
    read.walk.named.add(element);
  }
  const custom = tag.includes("-");
  const labelable = isLabelable(tag, node);
  if (custom || labelable) {
    for (const open of read.open.filter((label) => !label.found)) {
      addLabel(read.walk, element, open.label);
      open.found = labelable;
    }
  }
  if (tag !== "label") return undefined;
  const target = attributeOf(node, "for");
  if (target === undefined) return { label: element, found: false };
  read.forLabels.push([element, target]);
  return undefined;
}

/** Read `tree` in tree order, queueing the trees inside it on `trees`. */
function readTree(tree: LabelDomNode, trees: LabelDomNode[], walk: Walk): void {
  const read: TreeRead = { byId: new Map(), forLabels: [], open: [], walk };
  // A wrapping label closes once every node below it has been read.
  const stack: Array<LabelDomNode | OpenLabel> = [tree];
  while (stack.length > 0) {
    const step = stack.pop()!;
    if ("found" in step) {
      read.open.pop();
      continue;
    }
    // A form control's own internals hold no `<label>` of the page's.
    for (const sub of step.shadowRoots ?? []) {
      if (sub.shadowRootType !== "user-agent") trees.push(sub);
    }
    if (step.contentDocument) trees.push(step.contentDocument);
    const element = step.backendNodeId;
    const wrapping =
      step.nodeType === 1 && typeof element === "number"
        ? readElement(step, element, read)
        : undefined;
    if (wrapping) {
      read.open.push(wrapping);
      stack.push(wrapping);
    }
    // One push per child: a spread of a node with ~100k children would
    // overflow the call stack.
    const children = step.children ?? [];
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]!);
  }
  for (const [label, id] of read.forLabels) {
    const control = read.byId.get(id);
    if (control !== undefined) addLabel(walk, control, label);
  }
}

/**
 * Each element's labels, the way Chromium reads them for a control another
 * name takes in, as the {@link LabelsOf} of a walk of `root`: HTML's rule,
 * within each tree (a document or a shadow root). A `<label for>` labels the
 * element in its tree that holds the id; a `<label>` with no `for` labels its
 * first labelable descendant. An element the walk never met, inside a form
 * control's own internals or not in `root` at all, is `undefined`.
 *
 * Wider where it can't be sure, never narrower, since what it is for is
 * keeping a value out of a name: a `for` names whatever element holds the
 * id, labelable or not, and a custom element, which may be form-associated,
 * is labelled without ending a wrapping label's search.
 *
 * A control whose `aria-label` has text has none: Chromium reads that first,
 * and no label after it. Its own `aria-labelledby` is no reason to leave its
 * labels out — Chromium never follows one reference from inside another.
 */
export function domLabels(root: LabelDomNode): LabelsOf {
  const walk: Walk = { labels: new Map(), named: new Set(), seen: new Set() };
  // Each document or shadow root is a tree of its own: a `for` resolves in
  // its own, and a label's descendants never reach into another.
  const trees: LabelDomNode[] = [root];
  while (trees.length > 0) readTree(trees.pop()!, trees, walk);
  return (id) => {
    if (!walk.seen.has(id)) return undefined;
    return walk.named.has(id) ? [] : (walk.labels.get(id) ?? []);
  };
}

// ── The controls that lend a withheld value ─────────────────────────────────

/** A step of a name trace, with the elements a host-language source read
 *  (`nativeSourceValue`: a control's `<label>`s, a `<legend>`, …). */
interface LabelSource {
  attribute?: string;
  value?: { value?: unknown };
  nativeSourceValue?: AXPropertyValue;
}

/** Where the withheld values' roots are, as {@link valueRegions} finds them. */
export interface RootPlaces {
  roots: ReadonlySet<string>;
  /** The root at or around `raw`, or `null`. */
  rootOf(raw: RawAXNameNode): string | null;
  /** By raw id, the roots strictly beneath a node. */
  rootsUnder: ReadonlyMap<string, readonly string[]>;
}

/** What {@link labelLending} found. */
export interface LabelLending {
  /** By raw id, a node around a control Chromium doesn't ignore that lends
   *  withheld values through its labels, and those values' roots: what
   *  content named from the node takes in. A hidden control is skipped
   *  there, labels and all. */
  lending: ReadonlyMap<string, ReadonlySet<string>>;
  /** The roots whose values a reference to element `backendDOMNodeId` reads
   *  through a control's labels, or `undefined` when nothing says what
   *  labels it. A hidden target is read whole, a hidden control in it too. */
  reads(backendDOMNodeId: number): ReadonlySet<string> | undefined;
}

/**
 * The backend ids of the labels Chromium reads for `raw` when another name
 * takes it in, or `undefined` when nothing says which.
 *
 * From `raw`'s own name trace: each host-language step's elements, superseded
 * or not, since Chromium skips the control's own `aria-labelledby` there. None
 * when the trace has an `aria-label` with text, which Chromium reads first. A
 * node Chromium ignores has no trace, so the walk says (`labelsOf`). With no
 * trace and not ignored, as in an older recording: whatever its name came
 * from (`labelledby`).
 */
function labelsRead(
  raw: RawAXNameNode,
  labelsOf: LabelsOf | undefined,
): ReadonlyArray<number | undefined> | undefined {
  const sources: LabelSource[] = raw.name?.sources ?? [];
  if (sources.length > 0) {
    const authored = sources.some(
      (s) =>
        s.attribute === "aria-label" && hasAXText(String(s.value?.value ?? "")),
    );
    if (authored) return [];
    return sources.flatMap((s) =>
      (s.nativeSourceValue?.relatedNodes ?? []).map((r) => r.backendDOMNodeId),
    );
  }
  if (raw.ignored === true) {
    if (typeof raw.backendDOMNodeId !== "number") return [];
    return labelsOf?.(raw.backendDOMNodeId);
  }
  return (nativeAXProperty(raw, "labelledby")?.relatedNodes ?? []).map(
    (r) => r.backendDOMNodeId,
  );
}

/** Add `roots` to the set of each node above `raw` in `around`. */
function addAbove<T extends RawAXNameNode>(
  raw: T,
  byId: ReadonlyMap<string, T>,
  roots: readonly string[],
  around: Map<string, Set<string>>,
): void {
  for (const cur of nativeAncestry(raw, byId)) {
    if (cur === raw) continue;
    const known = around.get(cur.nodeId) ?? new Set<string>();
    around.set(cur.nodeId, known);
    const before = known.size;
    for (const root of roots) known.add(root);
    // A node that had them all had them added above it with them.
    if (known.size === before) break;
  }
}

/**
 * Which controls lend withheld values through their labels, and whose, given
 * where the values' `places` are. A label lends what it holds: a root, or a
 * node inside or around one, or a control that lends one through its own
 * labels, or a node around such a control, since Chromium reads a labelled
 * control inside a label by that control's labels. So this is grown to a
 * fixed point. A control inside a root lends nothing more: the root's own
 * value already withholds whatever reads it. Each lender keeps which roots it
 * lends, so a field named by its own label still leaves its own value out
 * when a control in that label lends it back (see `leavesOut`).
 *
 * Chromium reads a control with a value to lend (a `<select>`, a meter) by
 * that value, not its labels, but nothing in the tree tells it from a date
 * input, whose labels Chromium does read, so such a control lends all the
 * same: failing closed.
 *
 * Chromium reads a hidden node whole when a reference names it, a hidden
 * control in it by that control's labels, and skips a hidden node in a
 * visible one. A hidden node is an ignored one, so an ignored node reads
 * every lender beneath it, and any other node only those Chromium doesn't
 * ignore. That fails closed for an ignored node that isn't hidden.
 *
 * `standInsOf` holds the elements with no node of their own that something
 * stands in for (see `fieldStandIns`); a reference to any other such
 * element, or to an ignored one, lends by the walk's word, and with none,
 * lends.
 */
export function labelLending<T extends RawAXNameNode>(
  index: NativeAXIndex<T>,
  places: RootPlaces,
  standInsOf: ReadonlyMap<number, unknown>,
  labelsOf: LabelsOf | undefined,
): LabelLending {
  const { byId, byBackendId } = index;
  const lenders = new Map<string, Set<string>>();
  // Around every lender, and around one Chromium doesn't ignore.
  const holding = new Map<string, Set<string>>();
  const lending = new Map<string, Set<string>>();
  const unknown = new Set<string>();
  // What reading `node` reads of the roots' values through a control's
  // labels: as a lender itself, or around one.
  const lent = (node: T): string[] => [
    ...(lenders.get(node.nodeId) ?? []),
    ...((node.ignored === true ? holding : lending).get(node.nodeId) ?? []),
  ];
  // What reading the elements `ids` reads of the roots' values, every way.
  const carried = (ids: ReadonlyArray<number | undefined>): Set<string> => {
    const out = new Set<string>();
    for (const node of ids.map((id) => byBackendId.get(id ?? NaN))) {
      if (node === undefined) continue;
      const around = places.rootOf(node);
      if (around !== null) out.add(around);
      for (const root of places.rootsUnder.get(node.nodeId) ?? []) {
        out.add(root);
      }
      for (const root of lent(node)) out.add(root);
    }
    return out;
  };
  const candidates: Array<[T, ReadonlyArray<number | undefined>]> = [];
  for (const raw of places.roots.size > 0 ? byId.values() : []) {
    if (places.rootOf(raw) !== null) continue;
    const labels = labelsRead(raw, labelsOf);
    if (labels === undefined) unknown.add(raw.nodeId);
    else if (labels.length > 0) candidates.push([raw, labels]);
  }
  for (let grew = true; grew;) {
    grew = false;
    for (const [raw, labels] of candidates) {
      const known = lenders.get(raw.nodeId) ?? new Set<string>();
      const fresh = [...carried(labels)].filter((root) => !known.has(root));
      if (fresh.length === 0) continue;
      grew = true;
      for (const root of fresh) known.add(root);
      lenders.set(raw.nodeId, known);
      addAbove(raw, byId, fresh, holding);
      if (raw.ignored !== true) addAbove(raw, byId, fresh, lending);
    }
  }
  return {
    lending,
    reads: (id) => {
      const own = byBackendId.get(id);
      if (own !== undefined) {
        return unknown.has(own.nodeId) ? undefined : new Set(lent(own));
      }
      const walked = labelsOf?.(id);
      if (walked === undefined)
        return standInsOf.has(id) ? new Set() : undefined;
      return carried(walked);
    },
  };
}
