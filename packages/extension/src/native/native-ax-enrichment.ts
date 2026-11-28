/**
 * The enrichment passes over a native AX tree that need no transport: the
 * native node id format, states/properties/description facets, the
 * `aria-controls` relation, the region a withheld field covers, and the
 * tree's single root. Split out of `native-core.ts`, which re-exports them,
 * so every caller still finds them there.
 */

import {
  cleanAXText,
  nativeAXFacets,
  nativeNodeId,
  type A11yInfo,
  type NativeAXIndex,
} from "@real-a11y-dev/core";

import type { EnrichedNativeNode } from "./native-core-types.js";
import { nativeIdOf, type RawAXNode } from "./native-withholding.js";

/** The native node id for a DOM-backed node of this document:
 *  `ax-dom-<backendNodeId>`. The inverse of {@link backendNodeIdFrom}, and
 *  core's {@link nativeNodeId} with no frame: build ids through these, never
 *  by hand, so the format lives in one place. */
export function nativeIdForBackendNode(backendNodeId: number): string {
  return nativeNodeId(backendNodeId);
}

/** An AX node's states and properties (core's `nativeAXFacets`, one copy for
 *  every native transport), plus the accessible description: Chromium's own
 *  `aria-describedby`/`aria-description` resolution, a top-level AX field
 *  alongside `name`/`value`, not one of `properties`. Field VALUES are never
 *  read here (R1). A description is page-authored help/error text, not user
 *  input, the same distinction `browser`'s own producer draws. */
export function axFacets(
  raw: RawAXNode,
): Pick<A11yInfo, "states" | "properties" | "description"> {
  const description = raw.description?.value
    ? cleanAXText(String(raw.description.value))
    : "";
  return { ...nativeAXFacets(raw), description };
}

/**
 * The native ids of the nodes this one controls — Chromium's own resolution
 * of `aria-controls`, which arrives as an `idrefList` property carrying its
 * targets' `backendDOMNodeId`s rather than a scalar (so `axFacets` skips it).
 * Mapped through `nativeIdForBackendNode`, the one encoder of the id format,
 * and kept only when the target survived normalization: an unnamed wrapper
 * the normalizer dropped has no row to jump to. Empty for none.
 *
 * Why here and not in core's shared vocabulary (`core/src/native/`): this is
 * an enrichment pass over raw `properties`, like `axFacets` beside it, which
 * `normalizeNativeAX` never reads; the structural walk stays shared, and the
 * only consumer of the relation is this panel's jump chips — the CLI and MCP
 * render no chips. If one starts to, this moves to core with `axFacets`.
 *
 * Why only `controls`: `owns` is mostly structure — Chromium reparents an
 * owned node under its owner in the tree it sends, though not under an
 * `<input>`, which keeps its owned listbox a sibling. The sensitivity rule
 * follows `owns` too for that reason (core's `fieldRelationRoots`); a chip
 * for it is not parity with the shared panel. `describedby` is already
 * the node's `description`, resolved to text. `flowto` and `details` have no
 * chip in the shared panel to match, so they'd be a new feature rather than parity;
 * they're left for a ticket of their own.
 */
export function nativeControls(
  raw: RawAXNode,
  keptIds: ReadonlySet<string>,
): string[] {
  const prop = raw.properties?.find((p) => p.name === "controls");
  const ids: string[] = [];
  for (const related of prop?.value?.relatedNodes ?? []) {
    if (typeof related.backendDOMNodeId !== "number") continue;
    const id = nativeIdForBackendNode(related.backendDOMNodeId);
    if (keptIds.has(id) && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/**
 * The kept nodes that stand for `roots`, for withholding: each root the tree
 * kept, and for one the normalizer dropped (an unnamed wrapper around a
 * listbox), its nearest kept descendants. The jump chips' `nativeControls`
 * keeps only targets that have a row; this follows a dropped one down,
 * because what sits inside it is reached all the same. Which roots count is
 * core's `sensitiveChoiceRoots`, the rule the browser package withholds by
 * too: what a sensitive field, or a combobox around one, controls, owns or
 * holds.
 *
 * Exported for its tests.
 */
export function controlledRegion(
  roots: readonly RawAXNode[],
  index: NativeAXIndex<RawAXNode>,
  keptIds: ReadonlySet<string>,
): string[] {
  const stack = [...roots];
  const byNodeId = index.byId;
  const out: string[] = [];
  const seen = new Set<RawAXNode>();
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (seen.has(node)) continue;
    seen.add(node);
    const id = nativeIdOf(node);
    if (keptIds.has(id)) {
      out.push(id);
      continue;
    }
    for (const childId of node.childIds ?? []) {
      const child = byNodeId.get(childId);
      if (child) stack.push(child);
    }
  }
  return out;
}

/**
 * Find or synthesize the tree's single root, and reconcile `depth` to match.
 *
 * Mirrors `@real-a11y-dev/browser`'s `native-tree.ts` exactly (same
 * deliberate-mirror reason every other piece of this file has: that package
 * carries Playwright). `normalizeNativeAX` drops the `RootWebArea` and
 * generic/ignored html/body wrappers, so any ordinary page whose body has
 * more than one kept child — a plain `<header>`/`<main>`/`<footer>` layout,
 * not just a cross-frame payload — yields multiple parent-less nodes. The
 * DOM producer always has exactly one root; a consumer that wants to render
 * this as one tree (rather than the dogfood panel's flat depth-indented
 * list, which never needed a root at all) needs the same guarantee, so a
 * synthetic `document` root adopts every parent-less node instead of
 * silently truncating every root but the first.
 *
 * Mutates `nodes` in place: unshifts the synthetic root to the front (if one
 * was needed) and rewrites every node's `depth` to be its real distance from
 * the returned root id, since wrapping shifts the former roots down a level.
 * Front, not back: every existing consumer of this array — the dogfood
 * panel's flat depth-indented list (`DogfoodPanel.tsx`) today, any preorder-
 * walking consumer tomorrow — renders/walks it in array order with no
 * separate root lookup, so a root appended after its own descendants would
 * render as an indented forest followed by its own root.
 */
/**
 * The synthetic root's id — exported so a consumer that must NOT treat it as
 * a real AX node (the dogfood panel's flat list, which has no rootId concept
 * to render relative to and would otherwise show a page-produced-nothing-
 * like-this "document" row on every multi-root page) can filter it out by
 * identity rather than duplicating this string as a second magic literal.
 */
export const SYNTHETIC_ROOT_ID = "ax-root";

export function rootIdOf(nodes: EnrichedNativeNode[]): string {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const hasParent = new Set<string>();
  for (const n of nodes) for (const c of n.childIds) hasParent.add(c);
  const roots = nodes.filter((n) => !hasParent.has(n.id));

  let rootId: string;
  if (roots.length === 1) {
    rootId = roots[0]!.id;
  } else if (roots.length > 1) {
    rootId = SYNTHETIC_ROOT_ID;
    const synthetic: EnrichedNativeNode = {
      id: rootId,
      role: "document",
      name: "",
      depth: 0,
      backendDOMNodeId: null,
      childIds: roots.map((r) => r.id),
      states: {},
      properties: {},
      description: "",
    };
    nodes.unshift(synthetic);
    byId.set(rootId, synthetic);
  } else {
    return "";
  }

  const setDepth = (id: string, depth: number): void => {
    const node = byId.get(id);
    if (!node) return;
    node.depth = depth;
    for (const childId of node.childIds) setDepth(childId, depth + 1);
  };
  setDepth(rootId, 0);
  return rootId;
}
