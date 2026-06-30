// Deterministic text serialization of the Semantic Navigator tree.
export {
  serializeTree,
  serializeOutline,
  serializeTabSequence,
} from "./serialize.js";
export type { SerializeInput, SerializeOptions } from "./serialize.js";

export { extract } from "./extract.js";

// Re-export the core types serialization consumers commonly need.
export type {
  SemanticNode,
  ExtractionResult,
  TreeViewMode,
  OutlineEntry,
} from "@real-a11y-dev/core";
