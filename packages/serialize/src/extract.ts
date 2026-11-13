import {
  extractA11yTree,
  extractDomTree,
  type ExtractionResult,
  type RedactInputOption,
  type TreeViewMode,
} from "@real-a11y-dev/core";

/**
 * Pick the right extractor for the requested view mode. Defaults to the A11y
 * tree because that's what most serialization targets care about.
 */
export function extract(
  root: Element,
  mode: TreeViewMode = "a11y",
  options: RedactInputOption = {},
): ExtractionResult {
  return mode === "dom"
    ? extractDomTree(root, options)
    : extractA11yTree(root, options);
}
