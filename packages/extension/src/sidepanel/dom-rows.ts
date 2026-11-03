/**
 * The page's own walk's nodes, which the TAB view lists the tab order from.
 */

import type { DomSemanticNode, SemanticNode } from "@real-a11y-dev/core";

/**
 * The walk is DOM-produced, so every node carries all facets. Narrow a
 * looked-up node to {@link DomSemanticNode} at read sites that need `dom` /
 * `interaction` / `ui` (the `nodes` Map itself stays `SemanticNode`-typed so
 * it can still be passed to core helpers).
 */
export const asDom = (
  node: SemanticNode | undefined,
): DomSemanticNode | undefined => node as DomSemanticNode | undefined;
