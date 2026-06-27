// Serialization / snapshots — the canonical text format lives in
// @real-a11y-dev/serialize; re-exported here under this package's
// snapshot-flavored names so the testing API is unchanged.
export {
  serializeTree,
  serializeTree as auditSnapshot,
  serializeOutline as outlineSnapshot,
  serializeTabSequence as tabSequenceSnapshot,
} from "@real-a11y-dev/serialize";
export type { SerializeOptions } from "@real-a11y-dev/serialize";

// Assertions
export {
  assertNoUnlabeledInteractive,
  assertHeadingOrder,
  assertDialogsLabeled,
  assertLandmarkStructure,
  A11yAssertionError,
} from "./assertions.js";

// Raw primitives
export { dispatch } from "./dispatch.js";
export { waitForMutations } from "./wait.js";
export type { WaitForMutationsOptions } from "./wait.js";

// Interaction flow
export { flow, FlowChain } from "./flow.js";
export type { FlowOptions } from "./flow.js";

// Re-export core query helpers so consumers can import everything from a
// single entrypoint.
export {
  findByRole,
  findAllByRole,
  linearize,
  getOutline,
  getTabSequence,
  diffTrees,
} from "@real-a11y-dev/core";
export type {
  SemanticNode,
  ExtractionResult,
  FindByRoleOptions,
  OutlineEntry,
  TreeDiff,
  NodeChange,
  ActionResult,
  ActionType,
} from "@real-a11y-dev/core";
