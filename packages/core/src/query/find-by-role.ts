import type { SemanticNode } from "../types.js";

import { linearize } from "./linearize.js";
import {
  normalizeName,
  type FindByRoleOptions,
  type QueryInput,
} from "./types.js";

/** Internal: does this node satisfy every filter in `options`? */
function matches(
  node: SemanticNode,
  role: string,
  options: FindByRoleOptions,
): boolean {
  if (node.a11y.role !== role) return false;

  // Name filter
  if (options.name !== undefined) {
    const actual = normalizeName(node.a11y.name);
    if (typeof options.name === "string") {
      if (actual !== normalizeName(options.name)) return false;
    } else {
      if (!options.name.test(actual)) return false;
    }
  }

  // Heading level (stored as a string in a11y.properties)
  if (options.level !== undefined) {
    const level = node.a11y.properties?.level;
    if (level === undefined || Number(level) !== options.level) return false;
  }

  const state = (key: string) => node.a11y.states?.[key];

  if (options.checked !== undefined && state("checked") !== options.checked) {
    return false;
  }
  if (
    options.expanded !== undefined &&
    state("expanded") !== options.expanded
  ) {
    return false;
  }
  if (
    options.selected !== undefined &&
    state("selected") !== options.selected
  ) {
    return false;
  }
  if (options.pressed !== undefined && state("pressed") !== options.pressed) {
    return false;
  }
  if (
    options.disabled !== undefined &&
    state("disabled") !== options.disabled
  ) {
    return false;
  }

  return true;
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
