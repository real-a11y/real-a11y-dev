// Serialization / snapshots — the canonical text format lives in
// @real-a11y-dev/serialize; re-exported here under this package's
// snapshot-flavored names so the testing API is unchanged.
export {
  serializeTree,
  serializeTree as auditSnapshot,
  serializeOutline as outlineSnapshot,
  serializeTabSequence as tabSequenceSnapshot,
  serializeTreeDiff,
  extract,
} from "@real-a11y-dev/serialize";
export type {
  SerializeOptions,
  TreeDiffSerializeOptions,
} from "@real-a11y-dev/serialize";

// Interaction diff (assert what an interaction changed) — capture the tree
// before, diff against a fresh capture after. `a11yDiff`'s box renders through
// the same serializer as `a11ySnapshot` (register via `registerA11yMatchers`).
export { capture } from "./capture.js";
export type { A11yCapture } from "./capture.js";
export { a11yDiff } from "./diff.js";
export type { A11yDiffOptions } from "./diff.js";
export type { ChangeSpec, NodeMatcher, ChangedMatcher } from "./change-spec.js";

// Audit engine — the canonical home is @real-a11y-dev/audit; re-exported here
// so test authors get the assertions + findings API from one entrypoint.
export {
  assertNoUnlabeledInteractive,
  assertHeadingOrder,
  assertDialogsLabeled,
  assertLandmarkStructure,
  A11yAssertionError,
  collectFindings,
  listByRole,
  ALL_RULES,
  INTERACTIVE_ROLES,
} from "@real-a11y-dev/audit";
export type { Finding, A11yRule, RoleFilter } from "@real-a11y-dev/audit";

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
  ROLE_FILTER_GROUPS,
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
