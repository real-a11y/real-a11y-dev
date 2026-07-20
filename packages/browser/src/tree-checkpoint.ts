/**
 * In-page tree checkpoints (Axis A) — "what did this interaction change?".
 *
 * A checkpoint is the extracted tree itself, held INSIDE the page. Node ids are
 * WeakMap-derived and realm-bound, so a captured tree can only ever be diffed
 * within the page instance that produced it — and only until a navigation
 * replaces the bundle, which resets this module state.
 *
 * That page-instance binding is the deliberate asymmetry with the MCP *snapshot*
 * checkpoints (Axis B), which are pure data and survive navigation by design.
 * Node ids never leave the page: only the rendered diff crosses the boundary.
 */

import {
  diffTrees,
  extractA11yTree,
  type ExtractionResult,
  type SemanticNode,
} from "@real-a11y-dev/core";
import { serializeTreeDiff } from "@real-a11y-dev/serialize";

/** What `serializeTreeDiff` renders when nothing differs. */
const EMPTY_DIFF = "(no changes)";

let captured: ExtractionResult | undefined;

/** The node focused at capture time — the serializer renders the focus move. */
function focusNode(tree: ExtractionResult): SemanticNode | null {
  return tree.focusedId ? (tree.nodes.get(tree.focusedId) ?? null) : null;
}

/** Capture the current tree as the comparison point. Re-capturing re-baselines. */
export function checkpointTree(root: Element): string {
  captured = extractA11yTree(root);
  return `Tree checkpoint captured — ${captured.nodes.size} node(s). Interact with the page, then call diff_tree.`;
}

/** Diff the live tree against the checkpoint captured in THIS page load. */
export function diffSinceCheckpoint(root: Element): string {
  if (!captured) {
    throw new Error(
      "No tree checkpoint on this page — call checkpoint_tree first. A tree checkpoint is bound to the page instance and does not survive navigation.",
    );
  }
  const after = extractA11yTree(root);
  const rendered = serializeTreeDiff(diffTrees(captured, after), {
    focusBefore: focusNode(captured),
    focusAfter: focusNode(after),
  });
  // serializeTreeDiff renders this exact sentinel for an empty diff. Swap it
  // for something an agent can act on. Matching the literal — rather than
  // re-deriving "did anything change" from the diff — keeps the failure mode
  // safe: if the sentinel ever changes, the terse text shows through instead of
  // this message wrongly claiming nothing changed (a focus-only move still
  // renders a line, and must never be reported as "no changes").
  return rendered === EMPTY_DIFF
    ? "No tree changes since the checkpoint."
    : rendered;
}
