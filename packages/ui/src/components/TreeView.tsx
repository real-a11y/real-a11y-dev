/**
 * Full-featured tree view that handles its own DOM extraction and observation.
 *
 * For a version that accepts pre-extracted data (e.g. in the Storybook addon
 * manager panel), use `TreePanel` directly.
 */
import { useState, useCallback, useRef, useEffect } from "preact/hooks";
import type {
  SemanticNode,
  TreeViewMode,
  ActionType,
  ActionRequest,
  ExtractionResult,
} from "@real-a11y-dev/core";
import {
  extractDomTree,
  extractA11yTree,
  ActionDispatcher,
  FocusManager,
  DomObserver,
  getElementRefs,
} from "@real-a11y-dev/core";
import { TreePanel } from "./TreePanel.js";

export interface TreeViewProps {
  /** The root DOM element to extract the tree from */
  root: Element;
  /** Initial view mode */
  initialViewMode?: TreeViewMode;
  /** Enable interactive actions (click, navigate, etc.) */
  interactive?: boolean;
  /** Theme */
  theme?: "light" | "dark" | "auto";
  /**
   * Draw a highlight overlay on the real DOM element when the user hovers a
   * tree node. Defaults to `false` so the embedded TreeView does not disturb
   * the host app. The Chrome extension passes `true`.
   */
  highlightOnHover?: boolean;
  /**
   * Scroll the host element into view when a tree node is selected.
   * Defaults to `false`.
   */
  scrollHostOnSelect?: boolean;
  /**
   * When the primary action for a node is `"focus"`, actually move focus
   * on the host element. Other primary actions (click/submit/...) are
   * always dispatched regardless of this flag. Defaults to `false`.
   */
  focusHostOnActivate?: boolean;
  /** Callback when a node is selected */
  onNodeSelect?: (node: SemanticNode) => void;
  /** Callback when an action is dispatched */
  onAction?: (request: ActionRequest) => void;
}

export function TreeView({
  root,
  initialViewMode = "a11y",
  interactive = true,
  theme = "auto",
  highlightOnHover = false,
  scrollHostOnSelect = false,
  focusHostOnActivate = false,
  onNodeSelect,
  onAction,
}: TreeViewProps) {
  const [viewMode, setViewMode] = useState<TreeViewMode>(initialViewMode);
  const [treeData, setTreeData] = useState<ExtractionResult | null>(null);

  const dispatcherRef   = useRef<ActionDispatcher | null>(null);
  const focusManagerRef = useRef<FocusManager | null>(null);
  const observerRef     = useRef<DomObserver | null>(null);

  // Extract tree on mount and when view mode changes.
  // Tab mode reuses the a11y tree — no re-extraction needed.
  useEffect(() => {
    const extract = () => {
      const result =
        viewMode === "dom" ? extractDomTree(root) : extractA11yTree(root);
      setTreeData(result);
    };

    extract();

    const refs = getElementRefs();
    dispatcherRef.current   = new ActionDispatcher(refs);
    focusManagerRef.current = new FocusManager(refs);

    observerRef.current = new DomObserver(root, extract);
    observerRef.current.start();

    return () => {
      observerRef.current?.stop();
      focusManagerRef.current?.destroy();
    };
  }, [root, viewMode]);

  // ── Callbacks wired to DOM side-effects ────────────────────────────────────

  const handleSelect = useCallback(
    (nodeId: string, _node: SemanticNode) => {
      if (highlightOnHover || scrollHostOnSelect) {
        focusManagerRef.current?.highlightElement(nodeId, {
          scroll: scrollHostOnSelect,
          overlay: highlightOnHover,
        });
      }
    },
    [highlightOnHover, scrollHostOnSelect],
  );

  const handleActivate = useCallback(
    (nodeId: string, action: ActionType) => {
      if (!interactive) return;
      // A bare "focus" action only steals host focus when the consumer opted in.
      if (action === "focus" && !focusHostOnActivate) return;
      const request: ActionRequest = { nodeId, action };
      dispatcherRef.current?.dispatch(request);
      onAction?.(request);
    },
    [interactive, focusHostOnActivate, onAction],
  );

  const handleHover = useCallback(
    (nodeId: string | null) => {
      if (!highlightOnHover) return;
      if (nodeId) {
        focusManagerRef.current?.highlightElement(nodeId, {
          scroll: false,
          overlay: true,
        });
      } else {
        focusManagerRef.current?.clearHighlight();
      }
    },
    [highlightOnHover],
  );

  // ── Loading state ──────────────────────────────────────────────────────────

  if (!treeData) {
    const themeClass =
      theme === "dark" ? "sn-theme-dark"
      : theme === "light" ? "sn-theme-light"
      : "sn-theme-auto";
    return (
      <div class={`sn-root ${themeClass}`}>
        <div class="sn-empty">Extracting tree…</div>
      </div>
    );
  }

  return (
    <TreePanel
      treeData={treeData}
      viewMode={viewMode}
      onViewModeChange={setViewMode}
      theme={theme}
      onSelect={handleSelect}
      onActivate={handleActivate}
      onHover={handleHover}
      onNodeSelect={onNodeSelect}
    />
  );
}
