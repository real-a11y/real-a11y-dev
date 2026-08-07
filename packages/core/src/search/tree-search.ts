import type { SemanticNode, TreeViewMode, RoleFilter } from "../types.js";

/** Role groups for quick filtering */
export const ROLE_FILTER_GROUPS: Record<string, string[]> = {
  heading: ["heading"],
  link: ["link"],
  button: ["button"],
  form: [
    "textbox",
    "checkbox",
    "radio",
    "combobox",
    "listbox",
    "searchbox",
    "spinbutton",
    "slider",
  ],
  landmark: [
    "banner",
    "navigation",
    "main",
    "complementary",
    "contentinfo",
    "region",
    "form",
    "search",
  ],
  image: ["img"],
};

/** Display labels for role filters */
export const ROLE_FILTER_LABELS: Record<string, string> = {
  heading: "Headings",
  link: "Links",
  button: "Buttons",
  form: "Forms",
  landmark: "Landmarks",
  image: "Images",
};

/**
 * Search/filter tree nodes by query string.
 * Matches against tag name, role, accessible name, attributes, and text content.
 */
export function searchTree(
  nodes: Map<string, SemanticNode>,
  query: string,
  viewMode: TreeViewMode,
): Set<string> {
  return collectSearchMatches(nodes, query, viewMode).visibleIds;
}

/** Nodes a query selects, split into the matches themselves and what to show. */
interface SearchMatches {
  /** Nodes whose own content matched the query. */
  directIds: Set<string>;
  /** `directIds` plus every ancestor, so the path to each match is visible. */
  visibleIds: Set<string>;
}

/**
 * Run the match predicate over the tree exactly once, keeping the direct
 * matches and the visible set separately. Callers that need both (see
 * {@link applySearchFilter}) would otherwise have to re-run the predicate —
 * doubling the string matching and `Object.entries` allocation on every
 * keystroke.
 */
function collectSearchMatches(
  nodes: Map<string, SemanticNode>,
  query: string,
  viewMode: TreeViewMode,
): SearchMatches {
  const directIds = new Set<string>();
  const visibleIds = new Set<string>();
  if (!query.trim()) return { directIds, visibleIds };

  const lowerQuery = query.toLowerCase();

  for (const [id, node] of nodes) {
    if (matchesNode(node, lowerQuery, viewMode)) {
      directIds.add(id);
      visibleIds.add(id);
      // Also mark all ancestors as matching (so the path is visible)
      addAncestors(nodes, node, visibleIds);
    }
  }

  return { directIds, visibleIds };
}

/**
 * Add every ancestor of `node` to `into`, so the path down to it stays visible.
 *
 * Stops at the first ancestor already in the set: whatever put it there marked
 * its ancestors in the same breath, so the rest of the climb is redundant. That
 * turns a per-match walk to the root into one walk per distinct path segment,
 * and makes the loop terminate on a malformed tree whose `parentId` links form
 * a cycle.
 */
function addAncestors(
  nodes: Map<string, SemanticNode>,
  node: SemanticNode,
  into: Set<string>,
): void {
  let parentId = node.parentId;
  while (parentId && !into.has(parentId)) {
    into.add(parentId);
    const parent = nodes.get(parentId);
    parentId = parent?.parentId ?? null;
  }
}

function matchesNode(
  node: SemanticNode,
  query: string,
  viewMode: TreeViewMode,
): boolean {
  // Always search accessible name
  if (node.a11y.name.toLowerCase().includes(query)) return true;

  // Always search role
  if (node.a11y.role.toLowerCase().includes(query)) return true;

  if (viewMode === "dom" && node.dom) {
    // Search tag name
    if (node.dom.tagName.toLowerCase().includes(query)) return true;

    // Search key attributes
    for (const [key, val] of Object.entries(node.dom.attributes)) {
      if (key.toLowerCase().includes(query)) return true;
      if (val.toLowerCase().includes(query)) return true;
    }

    // Search text content
    if (node.dom.textContent?.toLowerCase().includes(query)) return true;
  }

  if (viewMode === "a11y") {
    // Search description
    if (node.a11y.description.toLowerCase().includes(query)) return true;

    // Search state values
    for (const [key, val] of Object.entries(node.a11y.states)) {
      if (key.toLowerCase().includes(query)) return true;
      if (String(val).toLowerCase().includes(query)) return true;
    }
  }

  return false;
}

/** Check if a node matches a role filter */
function matchesRoleFilter(
  node: SemanticNode,
  roleFilter: RoleFilter,
): boolean {
  if (!roleFilter) return true;
  const roles = ROLE_FILTER_GROUPS[roleFilter];
  return roles ? roles.includes(node.a11y.role) : true;
}

/**
 * Update the matchesFilter UI state on all nodes based on search and role filter.
 * Returns the count of directly matching nodes (not ancestors).
 */
export function applySearchFilter(
  nodes: Map<string, SemanticNode>,
  query: string,
  viewMode: TreeViewMode,
  roleFilter: RoleFilter = null,
): number {
  const hasQuery = query.trim().length > 0;
  const hasRoleFilter = roleFilter !== null;

  if (!hasQuery && !hasRoleFilter) {
    // No filters active — all nodes match. `ui` is panel-only; a tree without
    // it (native, off-panel) simply has nothing to flag.
    for (const node of nodes.values()) {
      if (node.ui) node.ui.matchesFilter = true;
    }
    return 0;
  }

  // Find nodes matching search query. One pass yields both the visible set and
  // the direct matches the count below reports.
  const search = hasQuery ? collectSearchMatches(nodes, query, viewMode) : null;

  // Find nodes matching role filter (include ancestors for path visibility)
  const roleMatchedIds = new Set<string>();
  if (hasRoleFilter) {
    for (const [id, node] of nodes) {
      if (matchesRoleFilter(node, roleFilter)) {
        roleMatchedIds.add(id);
        // Include ancestors
        addAncestors(nodes, node, roleMatchedIds);
      }
    }
  }

  // Apply combined filter: AND when both active, and count the direct matches
  // (nodes that match both filters themselves, not ancestors pulled in for the
  // path) in the same pass.
  let directMatches = 0;
  for (const [id, node] of nodes) {
    const matchesSearch = search ? search.visibleIds.has(id) : true;
    const matchesRole = hasRoleFilter ? roleMatchedIds.has(id) : true;
    if (node.ui) node.ui.matchesFilter = matchesSearch && matchesRole;

    const directSearchMatch = search ? search.directIds.has(id) : true;
    const directRoleMatch = hasRoleFilter
      ? matchesRoleFilter(node, roleFilter)
      : true;
    if (directSearchMatch && directRoleMatch) {
      directMatches++;
    }
  }

  return directMatches;
}
