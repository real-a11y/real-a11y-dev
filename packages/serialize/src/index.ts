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

// Typographic normalization for accessible-name COMPARISON — folds smart
// quotes / dashes / NBSP so an authored name matches a rendered one. Exported
// because `@real-a11y-dev/testing`'s name matchers consume it; the serialized
// output itself is never folded.
export { foldTypography } from "./normalize.js";

// Re-export the core types serialization consumers commonly need.
export type {
  SemanticNode,
  ExtractionResult,
  TreeViewMode,
  OutlineEntry,
  TreeDiff,
  NodeChange,
} from "@real-a11y-dev/core";
