/**
 * Where the DOM says a sensitive field's choice is made, for a relation
 * Chromium's tree drops (ADR-0001). An `aria-controls` that names an element
 * Chromium leaves out of its tree, such as a `role="presentation"` wrapper
 * around the listbox, is reported with no target at all, and the wrapper has
 * no node: from the tree alone the popup inside it is unreachable. Both
 * native transports already walk the document (`DOM.getDocument`, `depth:
 * -1, pierce: true`); this reads the same walk, and core's
 * `sensitiveChoiceRoots` takes what it finds.
 *
 * Pure. No transport.
 *
 * @internal
 */

import { resolveRoleToken } from "../extraction/role-map.js";
import {
  isSensitiveFieldAttributes,
  POPUP_CHOICE_ROLES,
} from "../extraction/sensitivity.js";

/**
 * A node of CDP's `DOM.getDocument`, as much as {@link domChoiceTargets}
 * reads. Both transports' own node types fit it.
 *
 * @internal
 */
export interface DomChoiceNode {
  backendNodeId?: number;
  nodeType?: number;
  nodeName?: string;
  localName?: string;
  attributes?: string[];
  children?: DomChoiceNode[];
  shadowRoots?: DomChoiceNode[];
  contentDocument?: DomChoiceNode;
  assignedSlot?: { backendNodeId?: number };
  /** On a shadow root: `open`, `closed` or `user-agent`. */
  shadowRootType?: string;
}

const ELEMENT_NODE = 1;

function attributeOf(node: DomChoiceNode, name: string): string | undefined {
  const attributes = node.attributes ?? [];
  for (let i = 0; i + 1 < attributes.length; i += 2) {
    if (attributes[i] === name) return attributes[i + 1];
  }
  return undefined;
}

/** The ids an IDREF list attribute names. */
function idrefs(node: DomChoiceNode, name: string): string[] {
  return (attributeOf(node, name) ?? "").trim().split(/\s+/).filter(Boolean);
}

/** The element's markup makes it a sensitive field (`isSensitiveField`). */
function isSensitiveMarkup(node: DomChoiceNode): boolean {
  return isSensitiveFieldAttributes(node.localName ?? node.nodeName ?? "", {
    type: attributeOf(node, "type") ?? null,
    autocomplete: attributeOf(node, "autocomplete") ?? null,
  });
}

/** The roles its `role` list names, as the tree resolves each token. */
function rolesOf(node: DomChoiceNode): string[] {
  return (attributeOf(node, "role") ?? "")
    .trim()
    .split(/\s+/)
    .flatMap((token) => {
      const role = token ? resolveRoleToken(token) : undefined;
      return role === undefined ? [] : [role];
    });
}

/**
 * Its `role` may make it a combobox: any token resolves to one. The tree can
 * skip a token before it (an unnamed `region`), so counting any is the side
 * that withholds more.
 */
function isCombobox(node: DomChoiceNode): boolean {
  return rolesOf(node).includes("combobox");
}

/**
 * A choice container by its markup: a `<select>`, or a `role` whose first
 * recognized token is one (`POPUP_CHOICE_ROLES`).
 */
function isChoiceContainer(node: DomChoiceNode): boolean {
  const tag = (node.localName ?? node.nodeName ?? "").toLowerCase();
  const role = rolesOf(node)[0];
  return (
    tag === "select" || (role !== undefined && POPUP_CHOICE_ROLES.has(role))
  );
}

/** Backend ids of `node` and everything under it, shadow roots included. */
function subtreeIds(node: DomChoiceNode, into: Set<number>): void {
  const pending = [node];
  for (let cur = pending.pop(); cur; cur = pending.pop()) {
    if (typeof cur.backendNodeId === "number") into.add(cur.backendNodeId);
    pending.push(...(cur.children ?? []), ...(cur.shadowRoots ?? []));
  }
}

/** What {@link walkDocument} found. */
interface DocumentWalk {
  /** Each element by backend id, with the id scope it resolves IDREFs in. */
  elements: Map<number, { node: DomChoiceNode; scope: IdScope }>;
  /** The element each sits in as Chromium lays it out (see below). */
  above: Map<number, number>;
  /** The elements whose markup makes them sensitive fields. */
  fields: Set<number>;
}

/** Every element with each id, in document order: a page may repeat one. */
type IdScope = Map<string, DomChoiceNode[]>;

/** One step of the walk: a node, its id scope, the element it sits in. */
type Step = [DomChoiceNode, IdScope, number?];

/** Record one element of the walk in `walk`. */
function meet(walk: DocumentWalk, [node, scope, parent]: Step): void {
  const id = node.backendNodeId;
  if (node.nodeType !== ELEMENT_NODE || typeof id !== "number") return;
  walk.elements.set(id, { node, scope });
  // eslint-disable-next-line no-restricted-properties -- a field of CDP's plain object, not the element's: nothing on the page shadows it
  const slot = node.assignedSlot?.backendNodeId;
  // A slotted node sits in its slot as Chromium lays it out.
  const holder = typeof slot === "number" ? slot : parent;
  if (holder !== undefined) walk.above.set(id, holder);
  const own = attributeOf(node, "id");
  if (own) scope.set(own, [...(scope.get(own) ?? []), node]);
  if (isSensitiveMarkup(node)) walk.fields.add(id);
}

/**
 * Every element in the document under `root`, each with its id scope (the
 * document, a shadow root, a frame's document) and what it sits in: its
 * parent, a shadow root's host, the `<slot>` that shows it. A frame's
 * document sits in nothing: its fields are its own.
 */
function walkDocument(root: DomChoiceNode): DocumentWalk {
  const walk: DocumentWalk = {
    elements: new Map(),
    above: new Map(),
    fields: new Set(),
  };
  const pending: Step[] = [[root, new Map()]];
  for (let step = pending.pop(); step; step = pending.pop()) {
    meet(walk, step);
    const [node, scope, parent] = step;
    const id = node.backendNodeId;
    const holder = node.nodeType === ELEMENT_NODE ? id : parent;
    if (node.contentDocument) pending.push([node.contentDocument, new Map()]);
    for (const shadow of node.shadowRoots ?? []) {
      pending.push([shadow, new Map(), holder]);
    }
    // A light child of an author shadow host is rendered only through a
    // slot (`meet` links that); unslotted, it sits in nothing.
    const host = (node.shadowRoots ?? []).some(
      (shadow) => shadow.shadowRootType !== "user-agent",
    );
    // Reversed, so the stack visits them in document order.
    for (const child of [...(node.children ?? [])].reverse()) {
      pending.push([child, scope, host ? undefined : holder]);
    }
  }
  return walk;
}

/** Every element one of `walk`'s sensitive fields sits in. */
function aroundFields({ fields, above }: DocumentWalk): Set<number> {
  const around = new Set<number>();
  for (const field of fields) {
    for (let at = above.get(field); at !== undefined; at = above.get(at)) {
      if (around.has(at)) break;
      around.add(at);
    }
  }
  return around;
}

/**
 * Backend ids of every DOM node in what a sensitive field, or a combobox
 * around one (the ARIA 1.1 wrapper), names in `aria-controls` or
 * `aria-owns`, each id read in the element's own tree scope: every element
 * carrying it. "Around" is the flat tree's: a parent, a shadow root's host,
 * the `<slot>` that shows the node. A frame's document is a scope of its own
 * and holds its own fields.
 *
 * @internal
 */
export function domChoiceTargets(root: DomChoiceNode): Set<number> {
  const walk = walkDocument(root);
  const targets = new Set<number>();
  if (walk.fields.size === 0) return targets;
  const around = aroundFields(walk);
  for (const [id, { node, scope }] of walk.elements) {
    if (walk.fields.has(id) || (around.has(id) && isCombobox(node))) {
      addHostTargets(walk, node, scope, targets);
    }
  }
  return targets;
}

/**
 * Add to `targets` what `host`, a sensitive field or a combobox around one,
 * reaches: the subtree of every element carrying an id it names in
 * `aria-controls` or `aria-owns`, and of the choice container around every
 * element carrying its `aria-activedescendant`. Every element with the id,
 * not only the first Chromium resolves: a page that renders a form twice, a
 * hidden copy first, would otherwise show the visible popup's choice.
 */
function addHostTargets(
  walk: DocumentWalk,
  host: DomChoiceNode,
  scope: IdScope,
  targets: Set<number>,
): void {
  for (const name of ["aria-controls", "aria-owns"]) {
    for (const ref of idrefs(host, name)) {
      for (const target of scope.get(ref) ?? []) subtreeIds(target, targets);
    }
  }
  for (const ref of idrefs(host, "aria-activedescendant")) {
    for (const active of scope.get(ref) ?? []) {
      subtreeIds(choiceContainerIn(walk, active) ?? active, targets);
    }
  }
}

/** The nearest choice container at or above `node` in `walk`, by markup. */
function choiceContainerIn(
  walk: DocumentWalk,
  node: DomChoiceNode,
): DomChoiceNode | undefined {
  let at = node.backendNodeId;
  while (at !== undefined) {
    const met = walk.elements.get(at)?.node;
    if (met && isChoiceContainer(met)) return met;
    at = walk.above.get(at);
  }
  return undefined;
}
