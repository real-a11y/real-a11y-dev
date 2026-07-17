// Deterministic text serialization of the Semantic Navigator tree.
export {
  serializeTree,
  serializeOutline,
  serializeTabSequence,
  serializeTreeDiff,
} from "./serialize.js";
export type {
  SerializeInput,
  SerializeOptions,
  TreeDiffSerializeOptions,
} from "./serialize.js";

export { extract } from "./extract.js";

// Re-export the core types serialization consumers commonly need.
export type {
  SemanticNode,
  ExtractionResult,
  TreeViewMode,
  OutlineEntry,
  TreeDiff,
  NodeChange,
} from "@real-a11y-dev/core";
