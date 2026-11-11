export { TreeView } from "./components/TreeView.js";
export type { TreeViewProps } from "./components/TreeView.js";
export { TreePanel } from "./components/TreePanel.js";
export type { TreePanelProps } from "./components/TreePanel.js";
export { preserveExpandedState } from "./preserve-expanded.js";
export { TreeNode } from "./components/TreeNode.js";
export { TreeToolbar } from "./components/TreeToolbar.js";
export { useTreeKeyboard } from "./hooks/useTreeKeyboard.js";
// @internal — the jump keys, shared with the extension's native tree; not a
// stability promise.
export {
  isJumpKey,
  JUMP_KEYS,
  JUMP_KEYSHORTCUTS,
  nextJump,
  type JumpCycle,
  type JumpLinks,
} from "./hooks/jumpKeys.js";
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
// @internal — the change marks (what each read of a tree found new, changed
// or removed), shared with the extension's native tree; not a stability
// promise.
export {
  diffTreeRows,
  isEmptyTreeChanges,
  NO_TREE_CHANGES,
  noteFieldChange,
  type DiffRules,
  type FieldChange,
  type RemovedRow,
  type Tree,
  type TreeChanges,
  type TreeRow,
} from "./tree-changes-diff.js";
export {
  compareThroughDialogs,
  type DialogComparison,
  type DialogRules,
  type OpenDialog,
} from "./tree-changes-dialogs.js";
export {
  compareInRun,
  type ReadRun,
  type RunBase,
} from "./tree-change-runs.js";
export {
  CHANGE_FLASH_MS,
  CHANGE_KEYSHORTCUTS,
  changeRowClass,
  describeChange,
  documentPositions,
  freshChanges,
  hiddenChangesByRow,
  hiddenChangesText,
  isChangeKey,
  marksForReaders,
  nextChangeStop,
  rowChangeMarks,
  rowsToOpen,
  summarizeChanges,
  withRowsOpen,
  type ChangeMarks,
  type HiddenChanges,
  type RowChangeMarks,
  type TreeChangesProp,
} from "./tree-changes.js";
export {
  useHiddenChanges,
  useTreeChanges,
  type ChangeNotice,
} from "./hooks/useTreeChanges.js";
// The marks for a tree of the DOM producer: TreeView's, and the Storybook
// addon's panel's.
export { shownChanges, usePageChanges } from "./hooks/usePageChanges.js";
export { semanticTreeRules } from "./semantic-tree-diff.js";
export {
  ChangeNoticeRegion,
  TreeChangesBar,
} from "./components/TreeChangesBar.js";
export { RowChangeTags } from "./components/RowChangeTags.js";
// @internal — shared with the extension's own popups; not a stability promise.
export { FOCUSABLE_SELECTOR, useDismissible } from "./hooks/useDismissible.js";
export { ShowFullNamesSetting } from "./components/ShowFullNamesSetting.js";
// @internal — shared with the extension's rows; not a stability promise.
export { isKeyState } from "./key-states.js";
export { KeyStatesForReaders } from "./components/KeyStatesForReaders.js";
export { useInputModality } from "./hooks/useInputModality.js";
export type { InputModality } from "./hooks/useInputModality.js";
export { useVirtualTree } from "./hooks/useVirtualTree.js";
