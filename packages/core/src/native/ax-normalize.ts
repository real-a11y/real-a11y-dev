/**
 * Pure normalization of a flat CDP `Accessibility.getFullAXTree` node list
 * into an ordered, depth-annotated tree in this engine's vocabulary.
 *
 * See `ax-vocabulary.ts` for why this lives in core (one copy, pure,
 * importable from Node / workers / browsers) and what is deliberately NOT
 * here (transport, DOM enrichment, redaction — `@real-a11y-dev/browser`).
 *
 * Ordering note (a real drift bug this consolidation fixed): the flat list
 * CDP returns is NOT in document order — a parent's children are ordered by
 * its `childIds` array, while unrelated subtrees interleave in the flat
 * list. Early spike normalizers grouped siblings by flat-list position and
 * silently shuffled them. This walker follows `childIds` from the roots, so
 * sibling order is Chromium's own.
 */

import {
  mapNativeAXRole,
  NATIVE_AX_DROP_ROLES,
  NATIVE_AX_NAME_SOURCE_ROLES,
} from "./ax-vocabulary.js";

/** The subset of CDP `Accessibility.AXNode` this normalizer consumes. */
export interface RawNativeAXNode {
  nodeId: string;
  parentId?: string;
  childIds?: string[];
  backendDOMNodeId?: number;
  ignored?: boolean;
  role?: { value?: string };
  name?: { value?: string };
}

/** One kept node of the normalized native tree, in document order. */
export interface NativeAXNode {
  /**
   * `ax-dom-<backendDOMNodeId>` when Chromium exposes a backing DOM node,
   * else `ax-<nodeId>`. Session-scoped — backend ids do not survive
   * navigation. A producer that resolves the DOM node should replace this
   * with the engine's shared id-generator id (RFC v3 §5.1 / R2).
   */
  id: string;
  role: string;
  name: string;
  /** Number of kept ancestors — indentation depth in serialized output. */
  depth: number;
  /** CDP backing-DOM reference for enrichment/dispatch; null for pure AX nodes. */
  backendDOMNodeId: number | null;
  /** Ids (in this normalized id space) of kept children, in Chromium's order. */
  childIds: string[];
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function isKept(node: RawNativeAXNode): boolean {
  const role = node.role?.value ?? "";
  return !node.ignored && role !== "" && !NATIVE_AX_DROP_ROLES.has(role);
}

function idOf(node: RawNativeAXNode): string {
  return typeof node.backendDOMNodeId === "number"
    ? `ax-dom-${node.backendDOMNodeId}`
    : `ax-${node.nodeId}`;
}

/**
 * Chromium often leaves a node's visible text on a `StaticText`/`LabelText`
 * descendant while the node's own name is empty — and the text is not always
 * a DIRECT child (`LabelText` usually carries no name itself; its text sits
 * on its own `StaticText` child, sometimes under a dropped `generic` too).
 * So promotion searches depth-first through the node's DROPPED descendants,
 * in document order, for the first named `StaticText`/`LabelText`. Kept
 * descendants are never entered: their text belongs to them.
 *
 * Callers only invoke this for normalized LEAVES (no kept descendants) with
 * an empty name. That guard is what keeps deep search safe — without it a
 * container like `main` would steal the text of a dropped form label deep in
 * its subtree. It also means a `textbox` whose *value* lives in a StaticText
 * child keeps its authored label: the name is only promoted when Chromium
 * left it empty.
 */
function promoteNameFromDroppedDescendants(
  node: RawNativeAXNode,
  byId: Map<string, RawNativeAXNode>,
): string {
  for (const childId of node.childIds ?? []) {
    const child = byId.get(childId);
    if (!child || isKept(child)) continue;
    if (NATIVE_AX_NAME_SOURCE_ROLES.has(child.role?.value ?? "")) {
      const text = collapseWhitespace(child.name?.value ?? "");
      if (text) return text;
    }
    const fromDescendants = promoteNameFromDroppedDescendants(child, byId);
    if (fromDescendants) return fromDescendants;
  }
  return "";
}

/**
 * Normalize a flat `getFullAXTree` node list: drop vocabulary noise and
 * ignored nodes, re-parent surviving descendants to the nearest kept
 * ancestor, promote names off dropped text children, and map Blink roles to
 * engine roles. Returns kept nodes in document order (parents before their
 * children).
 */
export function normalizeNativeAX(rawNodes: RawNativeAXNode[]): NativeAXNode[] {
  const byId = new Map(rawNodes.map((n) => [n.nodeId, n]));
  const out: NativeAXNode[] = [];
  const rawOf = new Map<NativeAXNode, RawNativeAXNode>();

  const visit = (
    nodeId: string,
    depth: number,
    parent: NativeAXNode | null,
  ): void => {
    const raw = byId.get(nodeId);
    if (!raw) return;
    if (!isKept(raw)) {
      // Flattened: children re-parent to the nearest kept ancestor,
      // at the same depth.
      for (const childId of raw.childIds ?? []) visit(childId, depth, parent);
      return;
    }
    const node: NativeAXNode = {
      id: idOf(raw),
      role: mapNativeAXRole(raw.role?.value ?? ""),
      name: collapseWhitespace(raw.name?.value ?? ""),
      depth,
      backendDOMNodeId:
        typeof raw.backendDOMNodeId === "number" ? raw.backendDOMNodeId : null,
      childIds: [],
    };
    out.push(node);
    rawOf.set(node, raw);
    parent?.childIds.push(node.id);
    for (const childId of raw.childIds ?? []) visit(childId, depth + 1, node);
  };

  // Multi-frame note: every raw node without a parentId is treated as a
  // top-level root, so a cross-frame payload (multiple RootWebAreas)
  // serializes child documents as separate top-level subtrees. Nesting them
  // at their <iframe> location needs frame metadata only a transport-aware
  // producer has (frameId → DOM.getFrameOwner) — that's
  // @real-a11y-dev/browser's job, not this pure module's.
  for (const root of rawNodes.filter((n) => !n.parentId)) {
    visit(root.nodeId, 0, null);
  }

  // Name promotion is a post-pass so the leaf guard can see the normalized
  // shape: only leaves (no kept descendants) may pull text from their
  // dropped subtree — see promoteNameFromDroppedDescendants.
  for (const node of out) {
    if (node.name || node.childIds.length > 0) continue;
    const raw = rawOf.get(node);
    if (raw) node.name = promoteNameFromDroppedDescendants(raw, byId);
  }

  return out;
}

/**
 * Serialize a normalized native tree in the engine's standard shape —
 * indented `role "name"` lines, comparable with `serializeTree` output.
 */
export function serializeNativeAX(nodes: NativeAXNode[]): string {
  return nodes
    .map((n) => {
      const label = n.name ? `${n.role} "${n.name}"` : n.role;
      return `${"  ".repeat(n.depth)}${label}`;
    })
    .join("\n");
}
