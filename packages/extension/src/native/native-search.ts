/**
 * Search + role-filter for the native producer's tree view — the native-mode
 * counterpart of `core`'s `applySearchFilter` (`core/src/search/tree-search.ts`),
 * which the DOM producer's own toolbar search box and role-filter pills use.
 *
 * Reuses `core`'s `ROLE_FILTER_GROUPS`/`ROLE_FILTER_LABELS` rather than
 * duplicating them: a native tree's roles come from `normalizeNativeAX`
 * (`core/src/native/`), which normalizes Chromium's AX roles against the same
 * vocabulary the DOM producer's role-map uses, so a `NativeNode.role` is
 * already comparable to the ARIA role strings those groups list.
 *
 * Can't reuse `applySearchFilter` itself, though: it mutates `SemanticNode`'s
 * `ui.matchesFilter` in place, and `NativeNode` (see `native-actions.ts`) has
 * no `ui` facet to flag — it's the flat wire shape, not a panel-only node.
 * This returns a derived id set instead of mutating anything.
 */

import { ROLE_FILTER_GROUPS, type RoleFilter } from "@real-a11y-dev/core";

import type { NativeNode } from "./native-actions.js";

function matchesQuery(node: NativeNode, lowerQuery: string): boolean {
  if (node.role.toLowerCase().includes(lowerQuery)) return true;
  if (node.name.toLowerCase().includes(lowerQuery)) return true;
  if (node.description?.toLowerCase().includes(lowerQuery)) return true;
  if (node.value?.toLowerCase().includes(lowerQuery)) return true;
  if (node.placeholder?.toLowerCase().includes(lowerQuery)) return true;

  for (const [key, val] of Object.entries(node.states ?? {})) {
    if (key.toLowerCase().includes(lowerQuery)) return true;
    if (String(val).toLowerCase().includes(lowerQuery)) return true;
  }
  for (const [key, val] of Object.entries(node.properties ?? {})) {
    if (key.toLowerCase().includes(lowerQuery)) return true;
    if (String(val).toLowerCase().includes(lowerQuery)) return true;
  }

  return false;
}

function matchesRoleFilter(node: NativeNode, roleFilter: RoleFilter): boolean {
  if (!roleFilter) return true;
  const roles = ROLE_FILTER_GROUPS[roleFilter];
  return roles ? roles.includes(node.role) : true;
}

/**
 * Add every ancestor of `id` to `into`, so the path down to a match stays
 * visible — mirrors `tree-search.ts`'s `addAncestors`, over `parentOf`
 * (native nodes carry no `parentId` of their own; see `NativeNode`'s
 * docstring) instead of a `nodes` map walk. Stops at the first ancestor
 * already in the set for the same reason: whatever put it there marked its
 * own ancestors already, and the early stop also terminates on a cycle.
 */
function addAncestors(
  parentOf: Map<string, string>,
  id: string,
  into: Set<string>,
): void {
  let current = parentOf.get(id);
  while (current && !into.has(current)) {
    into.add(current);
    current = parentOf.get(current);
  }
}

export interface NativeSearchResult {
  /** Ids whose own content matched both active filters — the count shown. */
  directIds: Set<string>;
  /** `directIds` plus every ancestor, so the path to each match is visible. */
  visibleIds: Set<string>;
}

const EMPTY_RESULT: NativeSearchResult = {
  directIds: new Set(),
  visibleIds: new Set(),
};

/**
 * Search + role-filter a native tree, matching `applySearchFilter`'s actual
 * combination semantics for the DOM producer — which is looser than a plain
 * per-node AND. Each filter gets its own ancestor-inclusive visibility set
 * (a node is "search-visible" if IT OR A DESCENDANT matches the query, and
 * "role-visible" if IT OR A DESCENDANT matches the role filter), and a node
 * is visible only if both sets include it. That lets a landmark stay visible
 * because it directly matches a role filter while a query match sits deeper
 * in its subtree, even though the landmark itself never matched the query —
 * collapsing the two into a single "does this exact node match both"
 * predicate would hide that landmark and disagree with the DOM producer on
 * the same page. `directIds` (the match count) stays strict, though: a node
 * only counts there if it directly satisfies both filters itself, not by
 * inheriting a descendant's match — mirrors `applySearchFilter`'s own
 * `directSearchMatch && directRoleMatch`.
 */
export function searchNativeTree(
  nodes: Map<string, NativeNode>,
  parentOf: Map<string, string>,
  query: string,
  roleFilter: RoleFilter,
): NativeSearchResult {
  const hasQuery = query.trim().length > 0;
  const hasRoleFilter = roleFilter !== null;
  if (!hasQuery && !hasRoleFilter) return EMPTY_RESULT;

  const lowerQuery = query.toLowerCase();

  const queryDirectIds = new Set<string>();
  const queryVisibleIds = new Set<string>();
  if (hasQuery) {
    for (const [id, node] of nodes) {
      if (matchesQuery(node, lowerQuery)) {
        queryDirectIds.add(id);
        queryVisibleIds.add(id);
        addAncestors(parentOf, id, queryVisibleIds);
      }
    }
  }

  const roleVisibleIds = new Set<string>();
  if (hasRoleFilter) {
    for (const [id, node] of nodes) {
      if (matchesRoleFilter(node, roleFilter)) {
        roleVisibleIds.add(id);
        addAncestors(parentOf, id, roleVisibleIds);
      }
    }
  }

  const directIds = new Set<string>();
  const visibleIds = new Set<string>();
  for (const [id, node] of nodes) {
    const searchVisible = hasQuery ? queryVisibleIds.has(id) : true;
    const roleVisible = hasRoleFilter ? roleVisibleIds.has(id) : true;
    if (searchVisible && roleVisible) visibleIds.add(id);

    const directSearchMatch = hasQuery ? queryDirectIds.has(id) : true;
    const directRoleMatch = hasRoleFilter
      ? matchesRoleFilter(node, roleFilter)
      : true;
    if (directSearchMatch && directRoleMatch) directIds.add(id);
  }

  return { directIds, visibleIds };
}
