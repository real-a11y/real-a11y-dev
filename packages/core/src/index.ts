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
  SemanticNavigatorConfig,
} from "./types.js";

// Extraction
export { extractDomTree, getElementRefs } from "./extraction/dom-extractor.js";
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

// Observation
export { DomObserver } from "./observation/dom-observer.js";

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
