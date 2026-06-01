/**
 * Full-featured tree view that handles its own DOM extraction and observation.
 *
 * For a version that accepts pre-extracted data (e.g. in the Storybook addon
 * manager panel), use `TreePanel` directly.
 */
import type {
  SemanticNode,
  TreeViewMode,
  ActionType,
  ActionRequest,
  ExtractionResult,
  Picker,
} from "@real-a11y-dev/core";
import {
  extractDomTree,
  extractA11yTree,
  ActionDispatcher,
  FocusManager,
  DomObserver,
  createPicker,
  getElementRefs,
} from "@real-a11y-dev/core";
import { useState, useCallback, useRef, useEffect } from "preact/hooks";

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
   * Gate actions that move focus on the host page. When `false` (default)
   * these are silently skipped to keep the panel a passive observer:
   *
   *   - `"focus"`: would call `.focus()` on the host element directly.
   *   - `"increment"` / `"decrement"`: dispatch a keydown that custom
   *     ARIA widgets (Radix Slider thumb, Headless UI date pickers, …)
   *     respond to by focusing themselves — so in same-document panels
   *     the focus ring ends up on the page even though we never asked
   *     for it.
   *
   * Other actions (`click`, `toggle`, `submit`, `select`, `type`) are
   * always dispatched regardless of this flag.
   */
  focusHostOnActivate?: boolean;
  /**
   * Surface a DevTools-style "select an element in the page" picker:
   * a toolbar button (⦿) + Ctrl/Cmd+Shift+C shortcut that lets the
   * user click any host-page element to jump to its tree row. Off by
   * default — the picker captures clicks at the document level and
   * preventDefaults them while active, so opt-in only.
   */
  enablePicker?: boolean;
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
  enablePicker = false,
  onNodeSelect,
  onAction,
}: TreeViewProps) {
  const [viewMode, setViewMode] = useState<TreeViewMode>(initialViewMode);
  const [treeData, setTreeData] = useState<ExtractionResult | null>(null);
  // Picker: panel-side mirror of the page-side createPicker state. The
  // picker itself owns the listeners + cursor; this state drives the
  // toolbar button's aria-pressed and the toggle.
  const [pickModeOn, setPickModeOn] = useState(false);
  const [pickedNodeId, setPickedNodeId] = useState<string | null>(null);

  const dispatcherRef = useRef<ActionDispatcher | null>(null);
  const focusManagerRef = useRef<FocusManager | null>(null);
  const observerRef = useRef<DomObserver | null>(null);
  const pickerRef = useRef<Picker | null>(null);

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
    dispatcherRef.current = new ActionDispatcher(refs);
    focusManagerRef.current = new FocusManager(refs);

    observerRef.current = new DomObserver(root, extract);
    observerRef.current.start();

    // Picker lifecycle is tied to the same effect so the same refs +
    // FocusManager are used for the highlight overlay. The picker
    // itself is inert until setEnabled(true) — creating it is cheap.
    if (enablePicker) {
      pickerRef.current = createPicker({
        doc: root.ownerDocument,
        // Same-document inline panels: no iframe layer, so isSubFrame is
        // always false (page-side picker handles its own iframe story
        // via window.top check; the React mount is always top-level).
        isSubFrame: false,
        findId: (el) => refs.findId(el),
        onHighlight: (nodeId) =>
          focusManagerRef.current?.highlightElement(nodeId, { scroll: false }),
        onClearHighlight: () => focusManagerRef.current?.clearHighlight(),
        onPicked: (nodeId) => setPickedNodeId(nodeId),
        onModeChange: (enabled) => setPickModeOn(enabled),
      });
    }

    return () => {
      observerRef.current?.stop();
      focusManagerRef.current?.destroy();
      pickerRef.current?.teardown();
      pickerRef.current = null;
    };
  }, [root, viewMode, enablePicker]);

  const togglePickMode = useCallback(() => {
    pickerRef.current?.setEnabled(!pickModeOn);
  }, [pickModeOn]);

  // Ctrl/Cmd+Shift+C global toggle, matching DevTools' picker shortcut.
  // Bound to the host document so it fires whether the panel has focus
  // or the host page does — same behavior as the extension panel.
  useEffect(() => {
    if (!enablePicker) return;
    const doc = root.ownerDocument;
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.shiftKey && (e.key === "C" || e.key === "c")) {
        e.preventDefault();
        pickerRef.current?.setEnabled(!pickerRef.current.isEnabled());
      }
    };
    doc.addEventListener("keydown", onKey);
    return () => doc.removeEventListener("keydown", onKey);
  }, [root, enablePicker]);

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
      // Gate every action that moves focus on the host. `focus` is the
      // obvious case; `increment`/`decrement` belong here too because
      // widgets like Radix Slider focus their own thumb on value change
      // — in a same-document panel that yanks focus away from the panel
      // button the user just clicked.
      if (
        !focusHostOnActivate &&
        (action === "focus" || action === "increment" || action === "decrement")
      ) {
        return;
      }
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
      theme === "dark"
        ? "sn-theme-dark"
        : theme === "light"
          ? "sn-theme-light"
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
      enablePicker={enablePicker}
      pickModeOn={pickModeOn}
      onTogglePickMode={togglePickMode}
      pickedNodeId={pickedNodeId}
      onPickedNodeHandled={() => setPickedNodeId(null)}
    />
  );
}
