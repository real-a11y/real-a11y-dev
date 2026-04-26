import type { SemanticNode } from "../types.js";

/**
 * Options for `findByRole` / `findAllByRole`.
 *
 * Semantics mirror Testing Library where reasonable, but operate on the
 * pre-extracted Semantic Navigator tree instead of the live DOM.
 */
export interface FindByRoleOptions {
  /**
   * Accessible name to match.
   * - `string` → case-insensitive, whitespace-normalized exact match.
   * - `RegExp` → tested against the normalized accessible name.
   */
  name?: string | RegExp;
  /** Heading level (1–6). Only meaningful when role is `"heading"`. */
  level?: number;
  /** Match only nodes whose `a11y.states.checked` matches. */
  checked?: boolean;
  /** Match only nodes whose `a11y.states.expanded` matches. */
  expanded?: boolean;
  /** Match only nodes whose `a11y.states.selected` matches. */
  selected?: boolean;
  /** Match only nodes whose `a11y.states.pressed` matches. */
  pressed?: boolean;
  /** Match only nodes whose `a11y.states.disabled` matches. */
  disabled?: boolean;
  /**
   * Include nodes that would be hidden from the accessibility tree
   * (`dom.isHidden === true` or `a11y.isExposedToAT === false`).
   * Defaults to `false`.
   */
  includeHidden?: boolean;
}

/** Input accepted by all query helpers. */
export type QueryInput =
  | { nodes: Map<string, SemanticNode>; rootId: string }
  | Map<string, SemanticNode>;

/** Normalize either form into the plain node Map. */
export function nodesOf(input: QueryInput): Map<string, SemanticNode> {
  return input instanceof Map ? input : input.nodes;
}

/** Resolve the root id if one was supplied; otherwise pick the first entry. */
export function rootIdOf(input: QueryInput): string | null {
  if (!(input instanceof Map)) return input.rootId;
  const first = input.keys().next();
  return first.done ? null : first.value;
}

/** Normalize whitespace and lowercase for name comparisons. */
export function normalizeName(name: string): string {
  return name.replace(/\s+/g, " ").trim().toLowerCase();
}
