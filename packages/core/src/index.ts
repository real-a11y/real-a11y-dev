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
  PAGE_STATE_VALUE_ROLES,
  RANGE_VALUE_ROLES,
  STATE_ONLY_ROLES,
  PANEL_HOST_ATTRIBUTE,
  type ExtractDomTreeOptions,
  type RedactInputOption,
} from "./extraction/dom-extractor.js";
// @internal — the element that holds focus, `<body>`/`<html>` counted as
// none, through open shadow roots: what the extractor marks as focused, for
// `testing`'s timeline. Not a stability promise.
export { resolveFocusedElement } from "./extraction/dom-extractor.js";
// The field-value sensitivity policy (ADR-0001), one for every producer.
export {
  holdsEnteredValue,
  isChoiceState,
  isSensitiveField,
  isSensitiveFieldAttributes,
  REDACTED_VALUE,
  SENSITIVE_AUTOCOMPLETE_TOKENS,
  VALUELESS_INPUT_TYPES,
} from "./extraction/sensitivity.js";
// @internal — the roles a sensitive choice is made in, for a reader of a
// tree outside core: the snapshot recorder, which keeps a choice's items
// alike and moves focus on one to its container. Shared policy, not a
// stable list.
export { POPUP_CHOICE_ROLES } from "./extraction/sensitivity.js";
// @internal — strict mode's test for what a user typed in, for a reader of
// the live page outside core: audit's finding locators.
export { insideEditor, withholdsState } from "./extraction/strict-mode.js";
export { withAriaOwnerIndex } from "./extraction/aria-owner.js";
// @internal — which rows of a read are of the page a panel was given, for the
// change marks; not a stability promise.
export { rootRowScope, type RowScope } from "./extraction/row-scope.js";
export { buildA11yTree, extractA11yTree } from "./extraction/a11y-extractor.js";
// The role of a row holding a run of its parent's own text, in both producers.
export { TEXT_RUN_ROLE } from "./text-run.js";
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
// @internal — what a screen reader could say for a live region, and which
// elements are one: the extension's live-region line and field state, and
// `testing`'s timeline, read the page's text through this one walk.
export { pageText } from "./extraction/page-text.js";
export {
  LIVE_REGION_ATTRIBUTES,
  liveRegionLevel,
} from "./extraction/overlay-scope.js";
export {
  flatChildNodes,
  isRenderedInFlatTree,
  renderingParent,
} from "./extraction/flat-tree.js";
export { isAriaHiddenValue } from "./extraction/aria-tokens.js";
export { safeGetAttribute, safeNodeType } from "./extraction/clobber-safe.js";
// @internal — clobber-safe reads for `testing`'s timeline, which walks the
// page's own DOM outside core. Not a stability promise.
export { safeContains, safeOwnerDocument } from "./extraction/clobber-safe.js";
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
  nativeAXStateValue,
} from "./native/ax-vocabulary.js";
export { normalizeNativeAX, serializeNativeAX } from "./native/ax-normalize.js";
// The one table of `a11y.properties` keys, and the split of a native node's
// properties into states and properties that reads it (@internal).
export {
  A11Y_PROPERTIES,
  CDP_PROPERTY_KEYS,
  a11yPropertyInfo,
  ariaAttributeOfProperty,
  nativePropertyKey,
} from "./a11y-properties.js";
export type {
  A11yPropertyInfo,
  A11yPropertyProducers,
} from "./a11y-properties.js";
export {
  NATIVE_AX_STATE_PROPERTIES,
  nativeAXFacets,
} from "./native/ax-facets.js";
export type { RawNativeAXFacetNode } from "./native/ax-facets.js";
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
  nonEmptyAXText,
  opensFieldInternals,
  valueRegions,
  winningNameSource,
  withholdFieldInternalText,
  withholdFieldInternals,
  withholdRegionNames,
} from "./native/value-regions.js";
export {
  dropBuiltInFileInputNames,
  withholdBrowserText,
} from "./native/file-input-name.js";
export {
  withholdPopupChoiceNames,
  withholdSensitiveFieldNames,
} from "./native/sensitive-names.js";
export type { DomReads } from "./native/sensitive-names.js";
export {
  domChoiceReads,
  domChoiceTargets,
} from "./native/dom-choice-targets.js";
export type { DomChoiceNode } from "./native/dom-choice-targets.js";
export type {
  FieldHostOf,
  FieldStandIn,
  NativeAXIndex,
  RawAXNameNode,
  ValueRegions,
} from "./native/value-regions.js";
export { nativeAncestry, nativeAXProperty } from "./native/ax-node.js";
export {
  carriesChoiceState,
  dropChoiceStates,
  fieldRelationRoots,
  sensitiveChoiceReach,
  sensitiveChoiceRoots,
  sensitivePopupRoots,
} from "./native/sensitive-popup.js";
export { domLabels } from "./native/labels.js";
export type { LabelDomNode, LabelsOf } from "./native/labels.js";

// Query helpers (for testing / audits / Storybook)
export {
  findByRole,
  findAllByRole,
  linearize,
  getOutline,
  getTabSequence,
  diffTrees,
} from "./query/index.js";
// @internal — a node as a view that singles it out may show it: a sensitive
// field's choice withheld (ADR-0001). For `testing`'s timeline.
export { asStop } from "./query/index.js";
export type {
  FindByRoleOptions,
  QueryInput,
  LinearizeOptions,
  OutlineEntry,
  NodeChange,
  TreeDiff,
} from "./query/index.js";
