export { TreeView } from "./components/TreeView.js";
export type { TreeViewProps } from "./components/TreeView.js";
export { TreePanel } from "./components/TreePanel.js";
export type { TreePanelProps } from "./components/TreePanel.js";
export { preserveExpandedState } from "./preserve-expanded.js";
export { TreeNode } from "./components/TreeNode.js";
export { TreeToolbar } from "./components/TreeToolbar.js";
export { useTreeKeyboard } from "./hooks/useTreeKeyboard.js";
export { resolveStepperKeyAction } from "./hooks/stepperKeys.js";
// @internal — shared with the extension's forked listboxes; not a stability promise.
export {
  createTypeAheadBuffer,
  findTypeAheadIndex,
  isTypeAheadKey,
  TYPE_AHEAD_TIMEOUT_MS,
} from "./hooks/typeAhead.js";
export type { TypeAheadBuffer } from "./hooks/typeAhead.js";
export { useSearch } from "./hooks/useSearch.js";
export { buildTreeDiffView, EMPTY_DIFF_VIEW } from "./diff.js";
export type { TreeDiffView, NodeDiffStatus } from "./diff.js";
export { useInputModality } from "./hooks/useInputModality.js";
export type { InputModality } from "./hooks/useInputModality.js";
export { useVirtualTree } from "./hooks/useVirtualTree.js";
// Exported for the extension's side panel, which renders its own tree over the
// same flattened id list and needs the same index to avoid rescanning it.
export { useIndexById } from "./hooks/useIndexById.js";
