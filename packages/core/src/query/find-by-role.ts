import type { SemanticNode } from "../types.js";

import { linearize } from "./linearize.js";
import {
  normalizeName,
  type FindByRoleOptions,
  type QueryInput,
} from "./types.js";

/** The state filters in `FindByRoleOptions`, each compared with `a11y.states`. */
const STATE_FILTERS = [
  "checked",
  "expanded",
  "selected",
  "pressed",
  "disabled",
] as const;

/** Internal: does the node's accessible name satisfy the `name` filter? */
function nameMatches(
  node: SemanticNode,
  filter: NonNullable<FindByRoleOptions["name"]>,
): boolean {
  const actual = normalizeName(node.a11y.name);
  return typeof filter === "string"
    ? actual === normalizeName(filter)
    : filter.test(actual);
}

/** Internal: does this node satisfy every filter in `options`? */
function matches(
  node: SemanticNode,
  role: string,
  options: FindByRoleOptions,
): boolean {
  if (node.a11y.role !== role) return false;

  if (options.name !== undefined && !nameMatches(node, options.name)) {
    return false;
  }

  // Heading level (stored as a string in a11y.properties)
  if (options.level !== undefined) {
    const level = node.a11y.properties?.level;
    if (level === undefined || Number(level) !== options.level) return false;
  }

  return STATE_FILTERS.every(
    (key) =>
      options[key] === undefined || node.a11y.states?.[key] === options[key],
  );
}

/**
 * The nodes a role query searches, in document order: only what AT can reach,
 * unless `includeHidden`. Both flags are set explicitly because `linearize`
 * defaults `includeNotExposed` to true, and passing the unset option straight
 * through kept every AT-hidden node, contrary to `includeHidden`'s docs.
 */
function searchable(input: QueryInput, options: FindByRoleOptions) {
  const all = options.includeHidden === true;
  return linearize(input, { includeHidden: all, includeNotExposed: all });
}

/**
 * Find the first node in document order with the given ARIA role.
 * Returns `null` if no node matches.
 */
export function findByRole(
  input: QueryInput,
  role: string,
  options: FindByRoleOptions = {},
): SemanticNode | null {
  return (
    searchable(input, options).find((node) => matches(node, role, options)) ??
    null
  );
}

/** Find every node with the given ARIA role, in document order. */
export function findAllByRole(
  input: QueryInput,
  role: string,
  options: FindByRoleOptions = {},
): SemanticNode[] {
  return searchable(input, options).filter((node) =>
    matches(node, role, options),
  );
}
