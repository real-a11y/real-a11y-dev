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
  DomSemanticNode,
  TreeProducerKind,
  TreeSource,
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
  finishAnnouncedValue,
  getAnnouncedValue,
  getElementRefs,
  RANGE_VALUE_ROLES,
  STATE_ONLY_ROLES,
  PANEL_HOST_ATTRIBUTE,
  type ExtractDomTreeOptions,
  type RedactInputOption,
} from "./extraction/dom-extractor.js";
// The field-value sensitivity policy (ADR-0001), one for every producer.
export {
  holdsEnteredValue,
  isSensitiveField,
  isSensitiveFieldAttributes,
  REDACTED_VALUE,
  SENSITIVE_AUTOCOMPLETE_TOKENS,
  VALUELESS_INPUT_TYPES,
} from "./extraction/sensitivity.js";
// @internal — which rows of a read are of the page a panel was given, for the
// change marks; not a stability promise.
export { rootRowScope, type RowScope } from "./extraction/row-scope.js";
export { buildA11yTree, extractA11yTree } from "./extraction/a11y-extractor.js";
// For a producer outside core (the native one) to stamp a tree as core does.
export { treeSource } from "./utils/tree-source.js";
// For a walk up the page's own DOM outside core, such as the extension's focus
// sync: a `<form>` control named `parentElement` makes the plain read cycle.
export { safeParentElement } from "./extraction/clobber-safe.js";
// For the extension's own reads of a page's text — a live region's
// announcement, an editor's text — which walk the tree the way the DOM
// producer does: the flat tree, what is rendered, what AT can reach, and the
// same elements skipped, read through the same clobber-safe accessors.
export { ignoresChildText, isTextVisible } from "./extraction/dom-extractor.js";
export {
  flatChildNodes,
  isRenderedInFlatTree,
  renderingParent,
} from "./extraction/flat-tree.js";
export { isAriaHiddenValue } from "./extraction/aria-tokens.js";
export { safeGetAttribute, safeNodeType } from "./extraction/clobber-safe.js";
export {
  getExplicitRole,
  getImplicitRole,
  isDatalistCombobox,
  isHiddenFromAT,
  isSubtreeHidden,
  getHeadingLevel,
  resolveRoleToken,
  selectRoleFromAttributes,
} from "./extraction/role-map.js";

// Interaction
export { ActionDispatcher } from "./interaction/action-dispatcher.js";
export { FocusManager } from "./interaction/focus-manager.js";
export { ACTION_LABELS, getPrimaryAction } from "./interaction/actions.js";
export { createPicker } from "./interaction/picker.js";
export type { Picker, PickerOptions } from "./interaction/picker.js";

// Observation
export {
  DomObserver,
  DOM_OBSERVER_DEBOUNCE_MS,
  DOM_OBSERVER_MAX_WAIT_MS,
} from "./observation/dom-observer.js";
export {
  LiveTreeExtractor,
  type LiveTreeExtractorOptions,
} from "./observation/live-tree-extractor.js";
// @internal — what the user does on a page, for the change marks; not a
// stability promise.
export {
  isUserInput,
  watchUserInput,
  type UserInput,
} from "./observation/user-input.js";

// Search
export {
  searchTree,
  applySearchFilter,
  ROLE_FILTER_GROUPS,
  ROLE_FILTER_LABELS,
} from "./search/tree-search.js";

// Utils
export { ElementRefMap } from "./utils/element-ref.js";
export {
  buildCssPath,
  isValidCssId,
  DOM_ELEMENT_ADAPTER,
  type CssPathAdapter,
} from "./utils/css-path.js";
export { getNodeId, resetIdCounter } from "./utils/id-generator.js";
export { realmSingleton } from "./utils/realm-singleton.js";
export {
  buildControlsIndex,
  indexControlLinks,
} from "./utils/controls-index.js";
export type {
  ControlLinkSource,
  ControlsIndex,
} from "./utils/controls-index.js";
export {
  isExtractionResult,
  describeTreeInput,
  treeInputError,
} from "./utils/tree-input.js";

// Native AX vocabulary — the ONE normalization of Chromium's CDP
// `Accessibility.getFullAXTree` payload into engine vocabulary. Pure (no
// CDP, no DOM globals): consumed by @real-a11y-dev/browser's native
// producer, the extension's debugger mode, and parity harnesses.
export {
  NATIVE_AX_VOCABULARY_VERSION,
  NATIVE_AX_DROP_ROLES,
  NATIVE_AX_DROP_UNLESS_NAMED,
  NATIVE_AX_DROP_WHEN_BARE,
  NATIVE_AX_EXPOSING_PROPERTIES,
  NATIVE_AX_ROLE_MAP,
  NATIVE_AX_NAME_SOURCE_ROLES,
  NATIVE_AX_OWN_TEXT_ROLES,
  NATIVE_AX_AUTHOR_NAMED_ROLES,
  NATIVE_AX_NAME_FROM_CONTENT_ROLES,
  NATIVE_AX_TEXT_OWNING_ROLES,
  mapNativeAXRole,
  NATIVE_AX_CHOICE_STATES,
  nativeAXStateValue,
} from "./native/ax-vocabulary.js";
export { normalizeNativeAX, serializeNativeAX } from "./native/ax-normalize.js";
// Frames in a native tree: the id scheme of a node in an out-of-process frame
// and the graft of a frame's nodes under its row (@internal).
export {
  graftNativeFrame,
  isNativeIframeRole,
  NATIVE_MAX_FRAME_DEPTH,
  nativeFrameSuffix,
  nativeNodeId,
  splitNativeNodeId,
  withNativeIdSuffix,
} from "./native/frames.js";
export type { NativeFrameRef, NativeGraftNode } from "./native/frames.js";
export type { NativeAXNode, RawNativeAXNode } from "./native/ax-normalize.js";
// Where a withheld field's value reaches other nodes' names, and the rule that
// keeps it out — shared by every native transport (@internal).
export {
  carriesAXValue,
  cleanAXText,
  fieldStandIns,
  givesValueAway,
  holdsContent,
  holdsUnclassifiedValue,
  indexNativeAX,
  ignoreFieldInternalImages,
  isNativePasswordMask,
  nativeAncestry,
  nativeAXProperty,
  nonEmptyAXText,
  opensFieldInternals,
  valueRegions,
  winningNameSource,
  withholdFieldInternalText,
  withholdFieldInternals,
  withholdRegionNames,
  withholdSensitiveFieldNames,
} from "./native/value-regions.js";
export type {
  FieldHostOf,
  FieldStandIn,
  NativeAXIndex,
  RawAXNameNode,
  ValueRegions,
} from "./native/value-regions.js";

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
