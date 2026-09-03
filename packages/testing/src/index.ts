// Serialization / snapshots — the canonical text format lives in
// @real-a11y-dev/serialize; re-exported here under this package's
// snapshot-flavored names (`treeSnapshot` / `outlineSnapshot` /
// `tabSequenceSnapshot`) so the testing API reads as the three views.
export {
  serializeTree,
  serializeTree as treeSnapshot,
  serializeOutline as outlineSnapshot,
  serializeTabSequence as tabSequenceSnapshot,
  serializeTreeDiff,
  extract,
  // `numberTabStops` is the documented companion to `tabSequenceSnapshot` —
  // snapshots.md tells you to render an explicit "stop 7" with it. With
  // `serialize` private it had no published home at all, so the doc pointed at
  // an install that no longer exists. Re-exported here, next to the serializer
  // it decorates, rather than losing a capability to a packaging change.
  numberTabStops,
} from "@real-a11y-dev/serialize";
export type {
  SerializeOptions,
  TreeDiffSerializeOptions,
} from "@real-a11y-dev/serialize";

// Interaction diff (assert what an interaction changed) — capture the tree
// before, diff against a fresh capture after. `a11yDiff`'s box renders through
// the same serializer as `boxedTreeSnapshot` (register via `registerA11yMatchers`).
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
  // `assertRules` and `formatFindings` were made public by a pending changeset
  // (`audit-assert-rules-native`) that announced them as an `audit` export. With
  // `audit` private that announcement had nowhere to land: the code would ship
  // inside this bundle with no way to call it. Re-exported here so the feature
  // is reachable and the changelog entry is true.
  assertRules,
  formatFindings,
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
