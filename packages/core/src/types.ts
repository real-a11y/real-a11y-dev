/** Action types that can be dispatched on a tree node */
export type ActionType =
  | "click"
  | "focus"
  | "type"
  | "submit"
  | "navigate"
  | "toggle"
  | "select"
  | "scroll";

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
  textContent: string | null;
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
   * When true, activating a tree node with the "focus" primary action
   * moves focus on the real element. Default `false`.
   */
  focusHostOnActivate?: boolean;
  /** Optional CSP nonce applied to the injected `<style>` element. */
  styleNonce?: string;

  onNodeSelect?: (node: SemanticNode) => void;
  onAction?: (request: ActionRequest, result: ActionResult) => void;
}
