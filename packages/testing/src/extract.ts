import {
  extractA11yTree,
  extractDomTree,
  type ExtractionResult,
  type TreeViewMode,
} from "@real-a11y-dev/core";

/**
 * Internal helper — pick the right extractor for the requested view mode.
 * Defaults to the A11y tree because that's what most audits care about.
 */
export function extract(
  root: Element,
  mode: TreeViewMode = "a11y",
): ExtractionResult {
  return mode === "dom" ? extractDomTree(root) : extractA11yTree(root);
}
