import { findByRole, type SemanticNode } from "@real-a11y-dev/core";
import { useMemo } from "react";

import { useSemanticTree } from "./useSemanticTree.js";

/**
 * Returns the currently-open `role="dialog"` or `role="alertdialog"` node
 * inside the ref'd root, or `null` if none is open.
 *
 * Handy for integration tests ("when the dialog appears, …") and for app
 * code that wants to react to modal presence without its own observer.
 */
export function useActiveModal(ref: {
  current: Element | null;
}): SemanticNode | null {
  const tree = useSemanticTree(ref);
  return useMemo(() => {
    if (!tree) return null;
    return findByRole(tree, "dialog") ?? findByRole(tree, "alertdialog");
  }, [tree]);
}
