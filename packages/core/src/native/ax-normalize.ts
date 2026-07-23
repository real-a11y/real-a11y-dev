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
 * child while the node's own name is empty. Those children are dropped by
 * the vocabulary, so an empty name is promoted from the first named one.
 * Never overrides a non-empty name (a `textbox` whose *value* lives in a
 * StaticText child keeps its label as the name).
 */
function promoteNameFromChildren(
  node: RawNativeAXNode,
  byId: Map<string, RawNativeAXNode>,
): string {
  for (const childId of node.childIds ?? []) {
    const child = byId.get(childId);
    if (!child || child.ignored) continue;
    if (!NATIVE_AX_NAME_SOURCE_ROLES.has(child.role?.value ?? "")) continue;
    const text = collapseWhitespace(child.name?.value ?? "");
    if (text) return text;
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
    const name =
      collapseWhitespace(raw.name?.value ?? "") ||
      promoteNameFromChildren(raw, byId);
    const node: NativeAXNode = {
      id: idOf(raw),
      role: mapNativeAXRole(raw.role?.value ?? ""),
      name,
      depth,
      backendDOMNodeId:
        typeof raw.backendDOMNodeId === "number" ? raw.backendDOMNodeId : null,
      childIds: [],
    };
    out.push(node);
    parent?.childIds.push(node.id);
    for (const childId of raw.childIds ?? []) visit(childId, depth + 1, node);
  };

  for (const root of rawNodes.filter((n) => !n.parentId)) {
    visit(root.nodeId, 0, null);
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
