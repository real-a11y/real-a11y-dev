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

// a11y contract verification — assert a serialized tree satisfies an authored
// contract (containment by default, `strict` for exact equality).
export { parseA11yTree, verifyContract } from "./contract.js";
export type {
  ContractNode,
  ParsedTree,
  ParseOptions,
  VerifyContractOptions,
  VerifyContractResult,
} from "./contract.js";

// Typographic name normalization, shared by the contract matcher and the
// testing package's name matchers.
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
