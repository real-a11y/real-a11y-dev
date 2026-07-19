/** Action types that can be dispatched on a tree node */
export type ActionType =
  | "click"
  | "focus"
  | "type"
  | "submit"
  | "navigate"
  | "toggle"
  | "select"
  | "scroll"
  | "increment"
  | "decrement";

/** Which tree representation to display */
export type TreeViewMode = "dom" | "a11y" | "tab";

/** Quick filter for node roles */
export type RoleFilter =
  | "heading"
  | "link"
  | "button"
  | "form"
  | "landmark"
  | "image"
  | null;

/** DOM-specific properties of a node */
export interface DomInfo {
  tagName: string;
  attributes: Record<string, string>;
  /** Text directly inside this element (text-node children only). */
  textContent: string | null;
  /**
   * Recursive text content of the element, truncated. Captures text from
   * descendants — including text nested inside spans, presentational
   * wrappers, and other non-text-bearing tags. Useful as a panel preview
   * for elements whose accessible name is empty by spec (`<code>`,
   * `<pre>`, `<svg>` containing `<text>`, etc.) but which carry
   * meaningful text content.
   */
  descendantText: string;
  isHidden: boolean;
}

/** Accessibility-specific properties of a node */
export interface A11yInfo {
  role: string;
  name: string;
  description: string;
  states: Record<string, string | boolean>;
  properties: Record<string, string>;
  isExposedToAT: boolean;
}

/** Interaction capabilities of a node */
export interface InteractionInfo {
  isInteractive: boolean;
  actions: ActionType[];
  isFocusable: boolean;
  isEditable: boolean;
}

/** UI state for the tree view (not serialized) */
export interface NodeUIState {
  expanded: boolean;
  highlighted: boolean;
  matchesFilter: boolean;
  selected: boolean;
}

/** The fundamental node in both tree views */
export interface SemanticNode {
  id: string;
  parentId: string | null;
  childIds: string[];
  depth: number;
  dom: DomInfo;
  a11y: A11yInfo;
  interaction: InteractionInfo;
  ui: NodeUIState;
}

/** Result of extracting a tree from the DOM */
export interface ExtractionResult {
  nodes: Map<string, SemanticNode>;
  rootId: string;
  /**
   * Node id of the element that held focus at extraction time, if that element
   * is present in this tree. Absent when focus rested on `<body>`/`<html>`
   * (nothing meaningfully focused) or the focused element lies outside the
   * extracted subtree. Serializers render it as a trailing `[focused]` marker.
   */
  focusedId?: string;
}

/** Request to perform an action on a node */
export interface ActionRequest {
  nodeId: string;
  action: ActionType;
  payload?: Record<string, unknown>;
}

/** Result of dispatching an action */
export interface ActionResult {
  success: boolean;
  error?: string;
  requiresInput?: boolean;
  inputType?: string;
}

/** Mutation event from DOM observation */
export interface TreeMutation {
  type: "added" | "removed" | "changed";
  nodeId: string;
  parentId?: string;
}

/** Change payload passed to a {@link DomObserver} callback.
 *
 * Includes the underlying MutationRecords and any synthetic dirty roots
 * (for example, form-control input events that MutationObserver cannot see).
 * Consumers that don't need incremental data can ignore the argument.
 */
export interface TreeChange {
  mutations?: MutationRecord[];
  /** Synthetic dirty roots for changes that don't produce MutationRecords. */
  dirtyRoots?: Element[];
  /** If true, the consumer should not attempt an incremental update. */
  full?: boolean;
}

/** Configuration for the Semantic Navigator */
export interface SemanticNavigatorConfig {
  /** Element whose subtree is extracted and displayed. */
  root: Element;
  /** Element the tree view is mounted into. */
  container: Element;
  /** Which tree representation to start on. Default "a11y". */
  viewMode?: TreeViewMode;
  /** Whether interactive actions (click/submit/etc.) are dispatched. Default true. */
  interactive?: boolean;
  /** Theme. Default "auto". */
  theme?: "light" | "dark" | "auto";
  /**
   * How to mount the TreeView into `container`.
   * - `"shadow"` (default) — encapsulated in a ShadowRoot; host CSS cannot
   *   leak in and SN CSS cannot leak out.
   * - `"light"` — rendered directly into `container`; host CSS can restyle.
   */
  mount?: "shadow" | "light";
  /**
   * When true, hovering a tree node draws a highlight overlay on the real
   * DOM element. Default `false` for the framework-agnostic embed (safe for
   * tests/audits); the Chrome extension opts in explicitly.
   */
  highlightOnHover?: boolean;
  /**
   * When true, selecting a tree node scrolls the real element into view.
   * Default `false` for the embed; the extension opts in explicitly.
   */
  scrollHostOnSelect?: boolean;
  /**
   * Gate actions that move focus on the host page. Default `false`.
   *
   * When `false` the panel skips:
   *   - the bare `"focus"` action
   *   - `"increment"` / `"decrement"` for sliders/spinbuttons (widgets
   *     like Radix Slider focus their own thumb on value change; in a
   *     same-document panel that pulls focus off the panel button)
   *
   * Other actions (`click`, `toggle`, `submit`, `select`, `type`) are
   * always dispatched regardless of this flag.
   */
  focusHostOnActivate?: boolean;
  /**
   * Surface a DevTools-style "select an element in the page" picker
   * (⦿ toolbar button + Ctrl/Cmd+Shift+C shortcut). When the user
   * clicks an element on the host page while pick mode is on, the
   * matching tree row is selected and scrolled into view. Off by
   * default — the picker captures clicks at the document level and
   * `preventDefault`s them while active, so opt-in only.
   */
  enablePicker?: boolean;
  /** Optional CSP nonce applied to the injected `<style>` element. */
  styleNonce?: string;

  onNodeSelect?: (node: SemanticNode) => void;
  onAction?: (request: ActionRequest, result: ActionResult) => void;
}
