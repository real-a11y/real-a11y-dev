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
 * Find the first node in document order with the given ARIA role.
 * Returns `null` if no node matches.
 */
export function findByRole(
  input: QueryInput,
  role: string,
  options: FindByRoleOptions = {},
): SemanticNode | null {
  const visible = linearize(input, {
    includeHidden: options.includeHidden,
    includeNotExposed: options.includeHidden,
  });
  for (const node of visible) {
    if (matches(node, role, options)) return node;
  }
  return null;
}

/** Find every node with the given ARIA role, in document order. */
export function findAllByRole(
  input: QueryInput,
  role: string,
  options: FindByRoleOptions = {},
): SemanticNode[] {
  const visible = linearize(input, {
    includeHidden: options.includeHidden,
    includeNotExposed: options.includeHidden,
  });
  return visible.filter((node) => matches(node, role, options));
}
