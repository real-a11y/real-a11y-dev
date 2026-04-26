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
  const matchedIds = new Set<string>();
  if (!query.trim()) return matchedIds;

  const lowerQuery = query.toLowerCase();

  for (const [id, node] of nodes) {
    if (matchesNode(node, lowerQuery, viewMode)) {
      matchedIds.add(id);

      // Also mark all ancestors as matching (so the path is visible)
      let parentId = node.parentId;
      while (parentId) {
        matchedIds.add(parentId);
        const parent = nodes.get(parentId);
        parentId = parent?.parentId ?? null;
      }
    }
  }

  return matchedIds;
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

  if (viewMode === "dom") {
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
function matchesRoleFilter(node: SemanticNode, roleFilter: RoleFilter): boolean {
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
    // No filters active — all nodes match
    for (const node of nodes.values()) {
      node.ui.matchesFilter = true;
    }
    return 0;
  }

  // Find nodes matching search query
  const searchMatchedIds = hasQuery
    ? searchTree(nodes, query, viewMode)
    : null;

  // Find nodes matching role filter (include ancestors for path visibility)
  const roleMatchedIds = new Set<string>();
  if (hasRoleFilter) {
    for (const [id, node] of nodes) {
      if (matchesRoleFilter(node, roleFilter)) {
        roleMatchedIds.add(id);
        // Include ancestors
        let parentId = node.parentId;
        while (parentId) {
          roleMatchedIds.add(parentId);
          const parent = nodes.get(parentId);
          parentId = parent?.parentId ?? null;
        }
      }
    }
  }

  // Apply combined filter: AND when both active
  let directMatches = 0;
  for (const [id, node] of nodes) {
    const matchesSearch = searchMatchedIds ? searchMatchedIds.has(id) : true;
    const matchesRole = hasRoleFilter ? roleMatchedIds.has(id) : true;
    node.ui.matchesFilter = matchesSearch && matchesRole;
  }

  // Count direct matches (nodes that match both filters directly, not ancestors)
  const lowerQuery = hasQuery ? query.toLowerCase() : "";
  for (const node of nodes.values()) {
    const directSearchMatch = hasQuery
      ? matchesNode(node, lowerQuery, viewMode)
      : true;
    const directRoleMatch = hasRoleFilter
      ? matchesRoleFilter(node, roleFilter)
      : true;
    if (directSearchMatch && directRoleMatch) {
      directMatches++;
    }
  }

  return directMatches;
}
