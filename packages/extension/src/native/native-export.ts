/**
 * Adapt a native-producer tree into the shape `@real-a11y-dev/serialize`
 * already knows how to render, so Copy/export reuses `serializeTree` /
 * `serializeOutline` instead of duplicating their formatting for a second
 * node shape. Two producers, one report format.
 *
 * `dom` / `interaction` / `ui` stay absent on every adapted node — exactly
 * what a native `SemanticNode` looks like elsewhere in this codebase (see
 * `SemanticNode`'s own doc comment) — and `linearize`/`getOutline` already
 * guard for that. `getTabSequence` also degrades gracefully (no
 * `interaction.isFocusable` on any node → empty sequence), but that reads as
 * "nothing focusable" rather than "we don't have this data", which is
 * actively misleading — callers should omit the tab-sequence view for a
 * native tree rather than serialize it. See `NATIVE_VIEWS` in `../sidepanel/
 * export.ts`.
 */

import type { ExtractionResult, SemanticNode } from "@real-a11y-dev/core";

import { nativeParentIndex, type NativeNode } from "./native-actions.js";

/**
 * Adapt a native tree (as held by the panel's `nativeNodes`/`nativeRootId`
 * state) into an `ExtractionResult` `serializeTree`/`serializeOutline` can
 * consume directly. `isExposedToAT: true` is a safe constant here: unlike
 * the DOM producer's walk (which visits every element and marks some
 * generic/unexposed), a native tree only ever contains nodes Chromium's own
 * AX tree already exposed — there is nothing further to distinguish.
 */
export function toExtractionResult(
  nodes: Map<string, NativeNode>,
  rootId: string,
): ExtractionResult {
  const parentOf = nativeParentIndex(nodes);
  const semanticNodes = new Map<string, SemanticNode>();

  for (const node of nodes.values()) {
    semanticNodes.set(node.id, {
      id: node.id,
      parentId: parentOf.get(node.id) ?? null,
      childIds: node.childIds ?? [],
      depth: node.depth,
      a11y: {
        role: node.role,
        name: node.name,
        description: node.description ?? "",
        states: node.states ?? {},
        properties: node.properties ?? {},
        isExposedToAT: true,
      },
    });
  }

  // Chromium marks the focused node with the `focused` AX property, which
  // lands in `a11y.states` above. Promote it to the tree-level pointer
  // `serializeTree`'s `[focused]` marker actually reads — the same
  // promotion `@real-a11y-dev/browser`'s own native adapter does (see
  // `native-tree.ts`'s identical comment) — otherwise a native tree knows
  // where focus is and the export just doesn't say so.
  const focused = [...semanticNodes.values()].find(
    (node) => node.a11y.states.focused === true,
  );

  return {
    nodes: semanticNodes,
    rootId,
    ...(focused ? { focusedId: focused.id } : {}),
    source: { producer: "native" },
  };
}
