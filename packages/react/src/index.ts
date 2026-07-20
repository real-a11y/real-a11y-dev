export { SemanticNavigator } from "./SemanticNavigator.js";
export type { SemanticNavigatorProps } from "./SemanticNavigator.js";

export { useSemanticTree } from "./useSemanticTree.js";
export type {
  UseSemanticTreeOptions,
  SemanticTreeTarget,
} from "./useSemanticTree.js";

export { useActiveModal } from "./useActiveModal.js";

// Re-export core types consumers typically need.
export type {
  SemanticNode,
  ExtractionResult,
  TreeViewMode,
  ActionRequest,
  ActionResult,
} from "@real-a11y-dev/core";
