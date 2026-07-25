/**
 * Role + accessible-name → native node id resolution — the targeting policy
 * for the action tools.
 *
 * `A11ySession.act()` needs a native node id (`ax-dom-<n>`), but node ids are
 * deliberately internal: no serializer emits them, and an agent never sees
 * one. Callers instead describe the target the way the tree prints it — ARIA
 * role plus accessible name — and resolve against a *fresh* `nativeTree()`
 * immediately before dispatch, so no id crosses a tool boundary and staleness
 * is confined to the instant between resolution and dispatch.
 *
 * This module is pure policy over core's `findAllByRole`: it decides what
 * "no match", "several matches", and "matched but un-actionable" look like as
 * data. Prose (error messages, remedies) belongs to each surface's renderer —
 * the MCP server and the CLI word the same refusal differently.
 */

import { findAllByRole } from "@real-a11y-dev/core";
import type { ExtractionResult, SemanticNode } from "@real-a11y-dev/core";

import { backendNodeIdFrom } from "./cdp-action-backend.js";

/** How a caller names a target — the tree's own vocabulary, never a node id. */
export interface ResolveTargetQuery {
  /** ARIA role, exactly as the tree prints it (`button`, `textbox`, …). */
  role: string;
  /**
   * Accessible name — case-insensitive, whitespace-normalized exact match.
   * `""` matches only unlabeled nodes; omit to match any name.
   */
  name?: string;
  /** 1-based pick among the role+name matches, in document order. */
  nth?: number;
}

/** One match, described in the serializer's vocabulary (role + name). */
export interface TargetCandidate {
  /** 1-based position among the matches, document order. */
  nth: number;
  role: string;
  name: string;
  /** Whether the node has a backing DOM element (`ax-dom-<n>`) to act on. */
  actionable: boolean;
  /** `a11y.states.disabled === true` — the page would ignore the action. */
  disabled: boolean;
}

export type ResolveTargetResult =
  | { kind: "resolved"; nodeId: string; candidate: TargetCandidate }
  /** Nothing matched role+name; `matchesForRole` counts role-only matches. */
  | { kind: "not-found"; matchesForRole: number }
  | { kind: "nth-out-of-range"; nth: number; matchCount: number }
  /** More than one match and no `nth`. Candidates are complete — callers cap rendering. */
  | { kind: "ambiguous"; candidates: TargetCandidate[] }
  /** Matched a node with no backing DOM element (`ax-<n>`, e.g. a synthesized root). */
  | { kind: "no-dom-node"; candidate: TargetCandidate };

/**
 * Resolve a role + name (+ nth) query against a native tree to an actionable
 * node id. Returns data only; never throws.
 */
export function resolveTarget(
  tree: ExtractionResult,
  query: ResolveTargetQuery,
): ResolveTargetResult {
  const matches = findAllByRole(
    tree,
    query.role,
    query.name !== undefined ? { name: query.name } : {},
  );

  if (matches.length === 0) {
    return {
      kind: "not-found",
      matchesForRole:
        query.name !== undefined ? findAllByRole(tree, query.role).length : 0,
    };
  }

  if (
    query.nth !== undefined &&
    (query.nth < 1 || query.nth > matches.length)
  ) {
    return {
      kind: "nth-out-of-range",
      nth: query.nth,
      matchCount: matches.length,
    };
  }

  if (query.nth === undefined && matches.length > 1) {
    return {
      kind: "ambiguous",
      candidates: matches.map((node, i) => candidateOf(node, i + 1)),
    };
  }

  const index = (query.nth ?? 1) - 1;
  const node = matches[index];
  const candidate = candidateOf(node, index + 1);

  if (!candidate.actionable) {
    return { kind: "no-dom-node", candidate };
  }

  return { kind: "resolved", nodeId: node.id, candidate };
}

function candidateOf(node: SemanticNode, nth: number): TargetCandidate {
  return {
    nth,
    role: node.a11y.role,
    name: node.a11y.name,
    actionable: backendNodeIdFrom(node.id) !== null,
    disabled: node.a11y.states.disabled === true,
  };
}
