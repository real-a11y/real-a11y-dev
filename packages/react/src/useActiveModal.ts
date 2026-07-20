import { findByRole, type SemanticNode } from "@real-a11y-dev/core";
import { useMemo } from "react";

import { useSemanticTree, type SemanticTreeTarget } from "./useSemanticTree.js";

/**
 * Returns the currently-open `role="dialog"` or `role="alertdialog"` node
 * inside the given root, or `null` if none is open.
 *
 * Handy for integration tests ("when the dialog appears, …") and for app
 * code that wants to react to modal presence without its own observer.
 *
 * Accepts an element or a ref object — see {@link SemanticTreeTarget} for why
 * passing the element is preferable when the root mounts late or is replaced.
 */
export function useActiveModal(
  target: SemanticTreeTarget,
): SemanticNode | null {
  const tree = useSemanticTree(target);
  return useMemo(() => {
    if (!tree) return null;
    return findByRole(tree, "dialog") ?? findByRole(tree, "alertdialog");
  }, [tree]);
}
