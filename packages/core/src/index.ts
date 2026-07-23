/**
 * Public entry point for `@real-a11y-dev/core`.
 *
 * Everything re-exported from this file is part of the package's public
 * API and follows the version contract documented in
 * [docs/STABILITY.md](https://github.com/real-a11y/real-a11y-dev/blob/main/docs/STABILITY.md).
 *
 * Symbols tagged `@internal` may change in any release, including patch
 * versions. Anything reachable only through a deep import of a
 * `dist/<file>.js` is internal even if not tagged.
 */

// Types
export type {
  ActionType,
  TreeViewMode,
  RoleFilter,
  DomInfo,
  A11yInfo,
  InteractionInfo,
  NodeUIState,
  SemanticNode,
  ExtractionResult,
  ActionRequest,
  ActionResult,
  TreeMutation,
  TreeChange,
  SemanticNavigatorConfig,
} from "./types.js";

// Extraction
export {
  extractDomTree,
  getElementRefs,
  isSensitiveField,
} from "./extraction/dom-extractor.js";
export { extractA11yTree } from "./extraction/a11y-extractor.js";
export {
  getImplicitRole,
  isHiddenFromAT,
  getHeadingLevel,
} from "./extraction/role-map.js";

// Interaction
export { ActionDispatcher } from "./interaction/action-dispatcher.js";
export { FocusManager } from "./interaction/focus-manager.js";
export { ACTION_LABELS, getPrimaryAction } from "./interaction/actions.js";
export { createPicker } from "./interaction/picker.js";
export type { Picker, PickerOptions } from "./interaction/picker.js";

// Observation
export { DomObserver } from "./observation/dom-observer.js";
export {
  LiveTreeExtractor,
  type LiveTreeExtractorOptions,
} from "./observation/live-tree-extractor.js";

// Search
export {
  searchTree,
  applySearchFilter,
  ROLE_FILTER_GROUPS,
  ROLE_FILTER_LABELS,
} from "./search/tree-search.js";

// Utils
export { ElementRefMap } from "./utils/element-ref.js";
export { getNodeId, resetIdCounter } from "./utils/id-generator.js";
export { buildControlsIndex } from "./utils/controls-index.js";
export type { ControlsIndex } from "./utils/controls-index.js";

// Native AX vocabulary — the ONE normalization of Chromium's CDP
// `Accessibility.getFullAXTree` payload into engine vocabulary. Pure (no
// CDP, no DOM globals): consumed by @real-a11y-dev/browser's native
// producer, the extension's debugger mode, and parity harnesses.
export {
  NATIVE_AX_VOCABULARY_VERSION,
  NATIVE_AX_DROP_ROLES,
  NATIVE_AX_ROLE_MAP,
  NATIVE_AX_NAME_SOURCE_ROLES,
  mapNativeAXRole,
} from "./native/ax-vocabulary.js";
export { normalizeNativeAX, serializeNativeAX } from "./native/ax-normalize.js";
export type { NativeAXNode, RawNativeAXNode } from "./native/ax-normalize.js";

// Query helpers (for testing / audits / Storybook)
export {
  findByRole,
  findAllByRole,
  linearize,
  getOutline,
  getTabSequence,
  diffTrees,
} from "./query/index.js";
export type {
  FindByRoleOptions,
  QueryInput,
  LinearizeOptions,
  OutlineEntry,
  NodeChange,
  TreeDiff,
} from "./query/index.js";
