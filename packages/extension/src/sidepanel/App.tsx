/// <reference types="chrome" />

import type {
  SemanticNode,
  TreeViewMode,
  RoleFilter,
  ActionRequest,
} from "@real-a11y-dev/core";
import {
  getPrimaryAction,
  ACTION_LABELS,
  applySearchFilter,
  ROLE_FILTER_LABELS,
  buildControlsIndex,
} from "@real-a11y-dev/core";
import {
  useTreeKeyboard,
  useInputModality,
} from "@real-a11y-dev/semantic-navigator-ui";
import { useSearch } from "@real-a11y-dev/semantic-navigator-ui";
import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from "preact/hooks";

import type { ContentToPanel } from "../types.js";

import { FilteredList } from "./FilteredList.js";
import { InputPanel } from "./InputPanel.js";
import type { InputPanelState } from "./InputPanel.js";
import { TabSequenceView } from "./TabSequenceView.js";

/**
 * Map HTML tag names to a human-readable display role when the ARIA role
 * ("generic" / "group") doesn't convey enough semantic information.
 *
 * Elements that already have a descriptive ARIA role (heading, button, link,
 * checkbox, etc.) are NOT listed here — the ARIA role is already meaningful.
 *
 * We use the HTML tag name as the display label for elements whose ARIA role
 * is "generic" or "group" but whose tag carries real semantic meaning,
 * following the principle of showing only valid HTML names (no invented labels).
 */
const TAG_DISPLAY_OVERRIDES: Record<string, string> = {
  // Structural elements that map to "group" in ARIA
  details: "details",
  address: "address",
  hgroup: "hgroup",
  optgroup: "optgroup",
  // Structural wrapper that frames a self-contained piece of content
  iframe: "iframe",
  // Form grouping element (has its own name from <legend>)
  fieldset: "fieldset",
  // Inline/block elements that map to "generic" in ARIA
  // but carry meaningful HTML semantics worth surfacing
  pre: "pre",
  abbr: "abbr",
  kbd: "kbd",
  samp: "samp",
  q: "q",
  var: "var",
  data: "data",
  small: "small",
  b: "b",
  i: "i",
  u: "u",
  s: "s",
  figcaption: "figcaption",
  // Media / embedded content
  video: "video",
  audio: "audio",
  canvas: "canvas",
  picture: "picture",
};

/** Return the role label to display for a node in A11Y view */
function getDisplayRole(node: SemanticNode): string {
  const override = TAG_DISPLAY_OVERRIDES[node.dom.tagName];
  if (override) return override;
  return node.a11y.role;
}

export function App() {
  const [viewMode, setViewMode] = useState<TreeViewMode>("a11y");
  const [nodes, setNodes] = useState<Map<string, SemanticNode>>(new Map());
  const [rootId, setRootId] = useState<string>("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [, forceRender] = useState(0);
  const [connected, setConnected] = useState(false);
  const [lastAction, setLastAction] = useState<string | null>(null);
  const [roleFilter, setRoleFilter] = useState<RoleFilter>(null);
  const [curtainOn, setCurtainOn] = useState(false);
  const [focusTrackerOn, setFocusTrackerOn] = useState(true);
  const [inputState, setInputState] = useState<InputPanelState | null>(null);
  const [pageTitle, setPageTitle] = useState<string>("");
  const [pageUrl, setPageUrl] = useState<string>("");
  const [scopedRootId, setScopedRootId] = useState<string | null>(null);
  const [liveAnnouncements, setLiveAnnouncements] = useState<
    Array<{ id: number; text: string; level: string; role: string }>
  >([]);
  const announcementId = useRef(0);

  const treeRef = useRef<HTMLDivElement>(null);
  const { query, matchCount, updateQuery, updateMatchCount } = useSearch();

  // aria-controls cross-link index (trigger ↔ controlled element). Used to
  // render clickable jump chips on disclosure pairs (button ↔ menu, tab ↔
  // panel, etc.) so the relationship is reachable without scroll-hunting.
  const controlsIndex = useMemo(() => buildControlsIndex(nodes), [nodes]);

  // Tree-node id currently flashing after a cross-link jump. Cleared by a
  // timeout so the flash plays once.
  const [flashingId, setFlashingId] = useState<string | null>(null);

  const handleJumpToNode = useCallback(
    (targetId: string) => {
      // Expand every collapsed ancestor so the target is in `visibleNodeIds`
      // before the existing scroll-into-view effect fires on selection.
      let cur: SemanticNode | undefined = nodes.get(targetId);
      let mutated = false;
      while (cur && cur.parentId) {
        const parent = nodes.get(cur.parentId);
        if (parent && !parent.ui.expanded) {
          parent.ui.expanded = true;
          mutated = true;
        }
        cur = parent;
      }
      if (mutated) forceRender((c) => c + 1);
      setSelectedId(targetId);
      setFlashingId(targetId);
      setTimeout(() => setFlashingId(null), 700);
    },
    [nodes],
  );

  // Keep a port alive so the background knows when the side panel closes.
  // On disconnect the background clears the highlight overlay AND disables
  // the focus tracker across every frame. On mount we push the panel's
  // current focus-tracker state to the content script — the tracker starts
  // OFF in content.ts, so this first SET_FOCUS_TRACKER is what turns it on.
  useEffect(() => {
    const port = chrome.runtime.connect({ name: "sidepanel" });
    chrome.runtime.sendMessage({
      type: "SET_FOCUS_TRACKER",
      payload: { enabled: focusTrackerOn },
    });
    return () => {
      port.disconnect();
    };
    // Intentionally empty deps: toggleFocusTracker handles subsequent changes;
    // this effect only handles the initial panel-open hand-off.
  }, []);

  // Listen for tree data and focus changes from content script
  useEffect(() => {
    const handler = (message: ContentToPanel) => {
      if (message.type === "TREE_DATA" || message.type === "TREE_UPDATED") {
        const nodeMap = new Map<string, SemanticNode>(message.payload.nodes);

        // Preserve user's expand/collapse state from previous tree
        setNodes((prev) => {
          for (const [id, node] of nodeMap) {
            const prevNode = prev.get(id);
            if (prevNode) {
              node.ui.expanded = prevNode.ui.expanded;
              node.ui.selected = prevNode.ui.selected;
            }
          }
          return nodeMap;
        });

        setRootId(message.payload.rootId);
        setConnected(true);
        // Reset scope if scoped node no longer exists in tree
        setScopedRootId((prev) => (prev && !nodeMap.has(prev) ? null : prev));
        if (message.type === "TREE_DATA" && "pageTitle" in message.payload) {
          setPageTitle(message.payload.pageTitle || "");
          setPageUrl(message.payload.pageUrl || "");
        }
      }

      if (message.type === "LIVE_REGION") {
        const id = ++announcementId.current;
        const entry = { id, ...message.payload };
        setLiveAnnouncements((prev) => [...prev.slice(-4), entry]);
        // Auto-remove after 8 seconds
        setTimeout(() => {
          setLiveAnnouncements((prev) => prev.filter((a) => a.id !== id));
        }, 8000);
      }

      if (message.type === "FOCUS_CHANGED") {
        const nodeId = message.payload.nodeId;
        setSelectedId(nodeId);

        // Expand ancestors so the node is visible
        setNodes((prev) => {
          let current = prev.get(nodeId);
          while (current?.parentId) {
            const parent = prev.get(current.parentId);
            if (parent && !parent.ui.expanded) {
              parent.ui.expanded = true;
            }
            current = parent;
          }
          return prev;
        });
        forceRender((n) => n + 1);

        // Scroll the tree item into view after render
        requestAnimationFrame(() => {
          const el = treeRef.current?.querySelector(
            `[data-node-id="${nodeId}"]`,
          );
          el?.scrollIntoView({ block: "nearest" });
        });
      }
    };

    chrome.runtime.onMessage.addListener(handler);

    // Request initial tree
    chrome.runtime.sendMessage({
      type: "REQUEST_TREE",
      payload: { viewMode },
    });

    return () => {
      chrome.runtime.onMessage.removeListener(handler);
    };
  }, []);

  const handleViewModeChange = useCallback((mode: TreeViewMode) => {
    setViewMode(mode);
    chrome.runtime.sendMessage({
      type: "SET_VIEW_MODE",
      payload: { viewMode: mode },
    });
  }, []);

  // Apply search + role filter
  useEffect(() => {
    if (nodes.size === 0) return;
    const count = applySearchFilter(nodes, query, viewMode, roleFilter);
    updateMatchCount(count);
    forceRender((n) => n + 1);
  }, [query, nodes, viewMode, roleFilter, updateMatchCount]);

  // Compute visible nodes
  const visibleNodeIds: string[] = [];
  function walkVisible(nodeId: string) {
    const node = nodes.get(nodeId);
    if (!node || !node.ui.matchesFilter) return;
    visibleNodeIds.push(nodeId);
    if (node.ui.expanded) {
      for (const childId of node.childIds) {
        walkVisible(childId);
      }
    }
  }
  const effectiveRootId = scopedRootId || rootId;
  const scopedRootNode = scopedRootId ? nodes.get(scopedRootId) : null;
  const scopedDepthOffset = scopedRootNode ? scopedRootNode.depth : 0;
  if (effectiveRootId) walkVisible(effectiveRootId);

  const handleSelect = useCallback((id: string) => {
    setSelectedId(id);
    chrome.runtime.sendMessage({
      type: "HIGHLIGHT_NODE",
      payload: { nodeId: id },
    });
  }, []);

  const handleToggle = useCallback(
    (id: string) => {
      const node = nodes.get(id);
      if (node) {
        node.ui.expanded = !node.ui.expanded;
        forceRender((n) => n + 1);
      }
    },
    [nodes],
  );

  // Switch from filtered list to tree view, selecting and revealing a node
  const handleGoToTree = useCallback(
    (id: string) => {
      setRoleFilter(null);
      setSelectedId(id);
      // Expand ancestors so the node is visible in the tree
      setNodes((prev) => {
        let current = prev.get(id);
        while (current?.parentId) {
          const parent = prev.get(current.parentId);
          if (parent && !parent.ui.expanded) {
            parent.ui.expanded = true;
          }
          current = parent;
        }
        return prev;
      });
      forceRender((n) => n + 1);
      // Highlight on the page
      chrome.runtime.sendMessage({
        type: "HIGHLIGHT_NODE",
        payload: { nodeId: id },
      });
      // Wait for the tree to render (filter → tree transition needs an extra frame)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const el = treeRef.current?.querySelector(`[data-node-id="${id}"]`);
          if (el) {
            el.scrollIntoView({ block: "center" });
            // Focus the tree so keyboard navigation works immediately
            treeRef.current?.focus();
          }
        });
      });
    },
    [nodes],
  );

  const handleActivate = useCallback(
    (id: string) => {
      const node = nodes.get(id);
      if (!node) return;

      const primaryAction = getPrimaryAction(node.interaction.actions);
      if (!primaryAction) {
        // Not interactive — toggle expand instead
        if (node.childIds.length > 0) handleToggle(id);
        return;
      }

      // Text input — open inline input panel
      if (
        primaryAction === "type" ||
        (primaryAction === "focus" && node.interaction.isEditable)
      ) {
        chrome.runtime.sendMessage(
          { type: "GET_FIELD_STATE", payload: { nodeId: id } },
          (response) => {
            if (response?.success) {
              setInputState({
                type: "text",
                nodeId: id,
                label: node.a11y.name || node.dom.tagName,
                value: response.value || "",
                inputType: response.type,
                placeholder: response.placeholder,
              });
            }
          },
        );
        return;
      }

      // Select — open option picker
      if (primaryAction === "select") {
        chrome.runtime.sendMessage(
          { type: "GET_FIELD_STATE", payload: { nodeId: id } },
          (response) => {
            if (response?.success && response.options) {
              setInputState({
                type: "select",
                nodeId: id,
                label: node.a11y.name || node.dom.tagName,
                value: response.value || "",
                options: response.options,
              });
            }
          },
        );
        return;
      }

      // All other actions — dispatch immediately
      const request: ActionRequest = {
        nodeId: id,
        action: primaryAction,
      };

      const name = node.a11y.name || node.dom.tagName;
      const role = node.a11y.role;

      // Contextual feedback based on role
      let feedback: string;
      if (role === "checkbox" || role === "switch") {
        const wasChecked = node.a11y.states.checked === true;
        feedback = wasChecked ? `Unchecked: ${name}` : `Checked: ${name}`;
      } else if (role === "radio") {
        feedback = `Selected: ${name}`;
      } else {
        feedback = `${ACTION_LABELS[primaryAction]}: ${name}`;
      }

      setLastAction(feedback);
      setTimeout(() => setLastAction(null), 2000);

      chrome.runtime.sendMessage(
        { type: "DISPATCH_ACTION", payload: request },
        (_response) => {
          if (chrome.runtime.lastError) {
            setLastAction(`Failed: ${chrome.runtime.lastError.message}`);
            setTimeout(() => setLastAction(null), 3000);
          }
          // Re-extract to reflect state change (checked, expanded, etc.)
          setTimeout(() => {
            chrome.runtime.sendMessage({
              type: "REQUEST_TREE",
              payload: { viewMode },
            });
          }, 100);
        },
      );
    },
    [nodes, handleToggle],
  );

  const handleInputSubmit = useCallback(
    (nodeId: string, value: string) => {
      const node = nodes.get(nodeId);
      const actionType = inputState?.type === "select" ? "select" : "type";

      chrome.runtime.sendMessage(
        {
          type: "DISPATCH_ACTION",
          payload: { nodeId, action: actionType, payload: { value } },
        },
        () => {
          const name = node?.a11y.name || nodeId;
          setLastAction(
            actionType === "select" ? `Selected: ${value}` : `Typed in ${name}`,
          );
          setTimeout(() => setLastAction(null), 2000);
          // Re-extract tree to reflect new values
          setTimeout(() => {
            chrome.runtime.sendMessage({
              type: "REQUEST_TREE",
              payload: { viewMode },
            });
          }, 100);
        },
      );
      setInputState(null);
    },
    [nodes, inputState, viewMode],
  );

  const handleInputCancel = useCallback(() => {
    setInputState(null);
  }, []);

  const toggleCurtain = useCallback(() => {
    const next = !curtainOn;
    setCurtainOn(next);
    chrome.runtime.sendMessage({
      type: "TOGGLE_CURTAIN",
      payload: { visible: next },
    });
  }, [curtainOn]);

  const toggleFocusTracker = useCallback(() => {
    const next = !focusTrackerOn;
    setFocusTrackerOn(next);
    chrome.runtime.sendMessage({
      type: "SET_FOCUS_TRACKER",
      payload: { enabled: next },
    });
  }, [focusTrackerOn]);

  // Modality flag — see useInputModality for the full rationale. Hover
  // handlers gate on isMouseModality() so keyboard-driven scroll doesn't
  // produce spurious mouseenter events that clobber the selection.
  const { isMouseModality, markKeyboard } = useInputModality();

  const handleHover = useCallback(
    (id: string | null) => {
      if (!isMouseModality()) return;
      if (id) {
        chrome.runtime.sendMessage({
          type: "HIGHLIGHT_NODE",
          payload: { nodeId: id },
        });
      } else {
        chrome.runtime.sendMessage({ type: "CLEAR_HIGHLIGHT" });
      }
    },
    [isMouseModality],
  );

  const handleExpandAll = useCallback(() => {
    for (const node of nodes.values()) {
      if (node.childIds.length > 0) node.ui.expanded = true;
    }
    forceRender((n) => n + 1);
  }, [nodes]);

  const handleCollapseAll = useCallback(() => {
    for (const node of nodes.values()) {
      if (node.depth > 0) node.ui.expanded = false;
    }
    forceRender((n) => n + 1);
  }, [nodes]);

  const handleScopeToNode = useCallback(
    (id: string | null) => {
      if (id) {
        const node = nodes.get(id);
        if (node) node.ui.expanded = true;
      }
      setScopedRootId(id);
      forceRender((n) => n + 1);
    },
    [nodes],
  );

  const handleSendKey = useCallback(
    (
      key: string,
      code: string,
      keyCode: number,
      modifiers?: { shift?: boolean },
    ) => {
      chrome.runtime.sendMessage(
        { type: "SEND_KEY", payload: { key, code, keyCode, modifiers } },
        (response) => {
          if (response?.success) {
            const label = modifiers?.shift
              ? `Shift+${key === "Tab" ? "Tab" : key}`
              : key;
            setLastAction(`Sent key: ${label}`);
            setTimeout(() => setLastAction(null), 1500);
          }
        },
      );
      setTimeout(() => {
        chrome.runtime.sendMessage({
          type: "REQUEST_TREE",
          payload: { viewMode },
        });
      }, 300);
    },
    [viewMode],
  );

  const { handleKeyDown } = useTreeKeyboard({
    nodes,
    visibleNodeIds,
    selectedId,
    onSelect: handleSelect,
    onToggle: handleToggle,
    onActivate: handleActivate,
  });

  // Scroll the selected tree item into view whenever selection changes
  // (covers both keyboard navigation and focus-sync from page)
  useEffect(() => {
    if (!selectedId) return;
    requestAnimationFrame(() => {
      const el = treeRef.current?.querySelector(
        `[data-node-id="${selectedId}"]`,
      );
      el?.scrollIntoView({ block: "nearest" });
    });
  }, [selectedId]);

  const prefersDark =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  const themeClass = prefersDark ? "sn-theme-dark" : "sn-theme-light";

  if (!connected) {
    return (
      <div class={`sn-root ${themeClass}`}>
        <div class="sn-page-header">
          <div class="sn-page-info">
            <span class="sn-page-title">
              Semantic Navigator
              <span
                class="sn-beta-pill"
                title="Semantic Navigator is in public beta. Feedback welcome on GitHub."
                aria-label="Beta version"
              >
                BETA
              </span>
            </span>
          </div>
        </div>
        <div class="sn-empty">
          Connecting to page...
          <br />
          <small>Make sure you're on a web page, then reload.</small>
        </div>
      </div>
    );
  }

  const handleCloseTab = useCallback(() => {
    chrome.runtime.sendMessage({ type: "CLOSE_TAB" }, (response) => {
      if (response?.success) {
        setLastAction("Tab closed");
        setTimeout(() => setLastAction(null), 2000);
      }
    });
  }, []);

  // Extract hostname for display
  const pageHost = (() => {
    try {
      return new URL(pageUrl).hostname;
    } catch {
      return "";
    }
  })();

  // Detect if tree root is a dialog (modal scoping from dom-extractor)
  const rootNode = rootId ? nodes.get(rootId) : null;
  const isDialogScoped =
    rootNode?.a11y.role === "dialog" || rootNode?.a11y.role === "alertdialog";

  // Build scope breadcrumb path
  const scopeBreadcrumb: Array<{ id: string; label: string }> = [];
  if (scopedRootId) {
    let current: SemanticNode | undefined = nodes.get(scopedRootId);
    while (current) {
      const lbl =
        viewMode === "a11y"
          ? `${getDisplayRole(current)}${current.a11y.name ? ` "${current.a11y.name}"` : ""}`
          : `<${current.dom.tagName}>`;
      scopeBreadcrumb.unshift({ id: current.id, label: lbl });
      current = current.parentId ? nodes.get(current.parentId) : undefined;
    }
  }

  return (
    <div class={`sn-root ${themeClass}`}>
      {/* Page info header */}
      {pageTitle && (
        <div class="sn-page-header">
          <div class="sn-page-info">
            <span class="sn-page-title" title={pageTitle}>
              {pageTitle}
              <span
                class="sn-beta-pill"
                title="Semantic Navigator is in public beta. Feedback welcome on GitHub."
                aria-label="Beta version"
              >
                BETA
              </span>
            </span>
            {pageHost && (
              <span class="sn-page-url" title={pageUrl}>
                {pageHost}
              </span>
            )}
          </div>
          <button
            class="sn-close-tab-btn"
            onClick={handleCloseTab}
            title="Close this tab"
            aria-label={`Close tab: ${pageTitle}`}
          >
            {"\u2715"}
          </button>
        </div>
      )}

      {/* Toolbar */}
      <div class="sn-toolbar" role="toolbar" aria-label="Tree controls">
        <input
          class="sn-search"
          type="search"
          placeholder="Search nodes..."
          aria-label="Search tree nodes"
          value={query}
          onInput={(e) => updateQuery((e.target as HTMLInputElement).value)}
        />
        {(query || roleFilter) && (
          <span class="sn-search-count" aria-live="polite">
            {matchCount} match{matchCount !== 1 ? "es" : ""}
          </span>
        )}

        <div class="sn-toggle-group" role="group" aria-label="Tree view mode">
          <button
            class="sn-toggle-btn"
            aria-pressed={viewMode === "dom"}
            onClick={() => handleViewModeChange("dom")}
          >
            DOM
          </button>
          <button
            class="sn-toggle-btn"
            aria-pressed={viewMode === "a11y"}
            onClick={() => handleViewModeChange("a11y")}
          >
            A11Y
          </button>
          <button
            class="sn-toggle-btn"
            aria-pressed={viewMode === "tab"}
            onClick={() => handleViewModeChange("tab")}
          >
            TAB
          </button>
        </div>

        <button
          class="sn-curtain-btn"
          aria-pressed={curtainOn}
          onClick={toggleCurtain}
          title={curtainOn ? "Show page content" : "Hide page content"}
        >
          {curtainOn ? "Curtain ON" : "Curtain"}
        </button>

        <button
          class="sn-focus-tracker-btn"
          aria-pressed={focusTrackerOn}
          onClick={toggleFocusTracker}
          title={
            focusTrackerOn
              ? "Focus sync ON — click to disable (useful on focus-heavy pages)"
              : "Focus sync OFF — click to enable"
          }
        >
          {focusTrackerOn ? "Focus sync" : "Focus OFF"}
        </button>

        <button
          class="sn-toolbar-btn"
          onClick={() => {
            chrome.runtime.sendMessage({
              type: "REQUEST_TREE",
              payload: { viewMode },
            });
            setLastAction("Tree refreshed");
            setTimeout(() => setLastAction(null), 1500);
          }}
          aria-label="Refresh tree"
          title="Refresh tree"
        >
          {"\u21BB"}
        </button>

        <button
          class="sn-toolbar-btn"
          onClick={handleExpandAll}
          disabled={viewMode === "tab"}
          aria-label="Expand all"
          title="Expand all"
        >
          +
        </button>
        <button
          class="sn-toolbar-btn"
          onClick={handleCollapseAll}
          disabled={viewMode === "tab"}
          aria-label="Collapse all"
          title="Collapse all"
        >
          -
        </button>
      </div>

      {/* Role filters — disabled in tab sequence view */}
      <div class="sn-filters" role="toolbar" aria-label="Filter by role">
        {(
          Object.keys(ROLE_FILTER_LABELS) as Array<Exclude<RoleFilter, null>>
        ).map((key) => (
          <button
            key={key}
            class="sn-filter-btn"
            aria-pressed={roleFilter === key}
            disabled={viewMode === "tab"}
            onClick={() => setRoleFilter(roleFilter === key ? null : key)}
          >
            {ROLE_FILTER_LABELS[key]}
          </button>
        ))}
      </div>

      {/* Dialog scope indicator */}
      {isDialogScoped && (
        <div class="sn-dialog-indicator" role="status">
          <span class="sn-dialog-label">
            Dialog: {rootNode?.a11y.name || "Modal"}
          </span>
          <button
            class="sn-key-btn"
            onClick={() => handleSendKey("Escape", "Escape", 27)}
            title="Send Escape key to close dialog"
          >
            Press ESC
          </button>
        </div>
      )}

      {/* Scope breadcrumb (when user scoped to a subtree) */}
      {scopedRootId && (
        <div class="sn-scope-bar">
          <button
            class="sn-scope-exit"
            onClick={() => handleScopeToNode(null)}
            title="Exit scope — show full tree"
            aria-label="Exit scope"
          >
            {"\u2715"}
          </button>
          <nav class="sn-breadcrumb" aria-label="Scope path">
            {scopeBreadcrumb.map((item, i) => (
              <span key={item.id} class="sn-breadcrumb-segment">
                {i > 0 && <span class="sn-breadcrumb-sep">{"\u203A"}</span>}
                <button
                  class={`sn-breadcrumb-item${item.id === scopedRootId ? " sn-breadcrumb-item--current" : ""}`}
                  onClick={() => {
                    if (item.id === scopedRootId) return;
                    if (item.id === rootId) {
                      handleScopeToNode(null);
                    } else {
                      handleScopeToNode(item.id);
                    }
                  }}
                  aria-current={
                    item.id === scopedRootId ? "location" : undefined
                  }
                >
                  {item.label}
                </button>
              </span>
            ))}
          </nav>
        </div>
      )}

      {/* Action feedback bar */}
      {lastAction && (
        <div class="sn-action-feedback" role="status" aria-live="assertive">
          {lastAction}
        </div>
      )}

      {/* Inline input panel for text / select interactions */}
      {inputState && (
        <InputPanel
          state={inputState}
          onSubmit={handleInputSubmit}
          onCancel={handleInputCancel}
        />
      )}

      {viewMode === "tab" ? (
        /* ---- Tab sequence view ---- */
        <TabSequenceView
          nodes={nodes}
          rootId={scopedRootId ?? rootId}
          query={query}
          onHighlight={handleSelect}
          onActivate={handleActivate}
        />
      ) : roleFilter ? (
        /* ---- Filtered list view ---- */
        <FilteredList
          nodes={nodes}
          roleFilter={roleFilter}
          query={query}
          onHighlight={handleSelect}
          onActivate={handleActivate}
          onGoToTree={handleGoToTree}
        />
      ) : (
        /* ---- Tree view ---- */
        <>
          <div
            class={`sn-tree-container${isDialogScoped ? " sn-tree-container--dialog" : ""}${scopedRootId ? " sn-tree-container--scoped" : ""}`}
          >
            <div
              ref={treeRef}
              class="sn-tree"
              role="tree"
              aria-label="Semantic tree — press Enter to activate interactive elements"
              tabIndex={0}
              onKeyDown={(e) => {
                markKeyboard();
                handleKeyDown(e);
              }}
            >
              {visibleNodeIds.map((id) => {
                const node = nodes.get(id);
                if (!node) return null;

                const hasChildren = node.childIds.length > 0;
                const primaryAction = getPrimaryAction(
                  node.interaction.actions,
                );
                const isSelected = id === selectedId;
                const displayDepth = scopedRootId
                  ? node.depth - scopedDepthOffset
                  : node.depth;

                return (
                  <div
                    key={id}
                    class={[
                      "sn-node",
                      isSelected && "sn-node--selected",
                      node.dom.isHidden && "sn-node--hidden",
                      node.interaction.isInteractive && "sn-node--interactive",
                      id === flashingId && "sn-node--flash",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    role="treeitem"
                    aria-expanded={hasChildren ? node.ui.expanded : undefined}
                    aria-selected={isSelected}
                    aria-level={displayDepth + 1}
                    data-node-id={id}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSelect(id);
                    }}
                    onDblClick={(e) => {
                      e.stopPropagation();
                      if (hasChildren && !node.interaction.isInteractive) {
                        handleScopeToNode(id);
                      } else if (node.interaction.isInteractive) {
                        handleActivate(id);
                      }
                    }}
                    onMouseEnter={() => handleHover(id)}
                    onMouseLeave={() => handleHover(null)}
                  >
                    <span class="sn-indent">
                      {Array.from({ length: displayDepth }, (_, i) => (
                        <span key={i} class="sn-indent-unit" />
                      ))}
                    </span>

                    <button
                      class={`sn-toggle ${!hasChildren ? "sn-toggle--leaf" : ""}`}
                      tabIndex={-1}
                      aria-hidden="true"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (hasChildren) handleToggle(id);
                      }}
                    >
                      {hasChildren
                        ? node.ui.expanded
                          ? "\u25BE"
                          : "\u25B8"
                        : ""}
                    </button>

                    <span class="sn-label">
                      {viewMode === "dom" ? (
                        <>
                          <span class="sn-tag">
                            {"<"}
                            {node.dom.tagName}
                            {">"}
                          </span>
                          {node.dom.textContent && (
                            <span class="sn-text-content">
                              {node.dom.textContent}
                            </span>
                          )}
                        </>
                      ) : (
                        <>
                          {/* Role — semantic display name */}
                          <span class="sn-role">{getDisplayRole(node)}</span>
                          {/* Heading level badge */}
                          {node.a11y.properties.level && (
                            <span class="sn-level-badge">
                              H{node.a11y.properties.level}
                            </span>
                          )}
                          {/* Iframe embedded content badge */}
                          {node.dom.tagName === "iframe" && (
                            <span class="sn-iframe-badge">embedded</span>
                          )}
                          {node.a11y.name && (
                            <span class="sn-name">{node.a11y.name}</span>
                          )}
                          {/* Accessible description — from aria-describedby / aria-description */}
                          {node.a11y.description && (
                            <span
                              class="sn-description"
                              title={node.a11y.description}
                            >
                              {node.a11y.description.length > 80
                                ? node.a11y.description.slice(0, 80) + "\u2026"
                                : node.a11y.description}
                            </span>
                          )}
                          {/* Current value for editable fields */}
                          {node.interaction.isEditable &&
                            (() => {
                              const val = node.dom.attributes.value;
                              const inputType =
                                node.dom.attributes.type || "text";
                              if (val) {
                                const display =
                                  inputType === "password"
                                    ? "\u2022".repeat(val.length)
                                    : val;
                                return (
                                  <span class="sn-field-value">
                                    = "{display}"
                                  </span>
                                );
                              }
                              return null;
                            })()}
                          {/* State badges: disabled, checked, required, expanded, etc. */}
                          {(() => {
                            const states = node.a11y.states;
                            const badges: Array<{
                              label: string;
                              cls: string;
                            }> = [];
                            if (states.disabled === true)
                              badges.push({
                                label: "disabled",
                                cls: "sn-state--disabled",
                              });
                            if (states.checked === true)
                              badges.push({
                                label: "checked",
                                cls: "sn-state--on",
                              });
                            if (states.checked === "mixed")
                              badges.push({
                                label: "mixed",
                                cls: "sn-state--mixed",
                              });
                            if (states.pressed === true)
                              badges.push({
                                label: "pressed",
                                cls: "sn-state--on",
                              });
                            if (states.selected === true)
                              badges.push({
                                label: "selected",
                                cls: "sn-state--on",
                              });
                            if (states.expanded === true)
                              badges.push({
                                label: "expanded",
                                cls: "sn-state--info",
                              });
                            if (states.expanded === false)
                              badges.push({
                                label: "collapsed",
                                cls: "sn-state--info",
                              });
                            if (states.required === true)
                              badges.push({
                                label: "required",
                                cls: "sn-state--required",
                              });
                            if (states.readonly === true)
                              badges.push({
                                label: "readonly",
                                cls: "sn-state--info",
                              });
                            if (states.busy === true)
                              badges.push({
                                label: "busy",
                                cls: "sn-state--info",
                              });
                            if (states.current)
                              badges.push({
                                label: `current: ${states.current}`,
                                cls: "sn-state--info",
                              });
                            if (badges.length === 0) return null;
                            return (
                              <span class="sn-state-badges">
                                {badges.map((b) => (
                                  <span
                                    key={b.label}
                                    class={`sn-state-badge ${b.cls}`}
                                  >
                                    {b.label}
                                  </span>
                                ))}
                              </span>
                            );
                          })()}
                          {/* aria-controls cross-links: jump to controlled element(s) */}
                          {controlsIndex.forward.get(id)?.map((targetId) => {
                            const target = nodes.get(targetId);
                            if (!target) return null;
                            const role = getDisplayRole(target);
                            const name = target.a11y.name;
                            return (
                              <button
                                key={`controls-${targetId}`}
                                class="sn-controls-link"
                                tabIndex={-1}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleJumpToNode(targetId);
                                }}
                                title={`Jump to the ${role} this element controls`}
                              >
                                {"→ "}
                                {role}
                                {name && ` "${name.length > 24 ? name.slice(0, 24) + "…" : name}"`}
                              </button>
                            );
                          })}
                          {/* Reverse cross-links: jump back to the trigger(s) controlling this element */}
                          {controlsIndex.reverse.get(id)?.map((triggerId) => {
                            const trigger = nodes.get(triggerId);
                            if (!trigger) return null;
                            const role = getDisplayRole(trigger);
                            const name = trigger.a11y.name;
                            return (
                              <button
                                key={`controlled-by-${triggerId}`}
                                class="sn-controls-link sn-controls-link--reverse"
                                tabIndex={-1}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleJumpToNode(triggerId);
                                }}
                                title={`Jump to the ${role} that controls this element`}
                              >
                                {"← "}
                                {role}
                                {name && ` "${name.length > 24 ? name.slice(0, 24) + "…" : name}"`}
                              </button>
                            );
                          })}
                        </>
                      )}

                      {primaryAction && (
                        <span class="sn-action-tag">
                          {ACTION_LABELS[primaryAction]}
                        </span>
                      )}
                    </span>

                    {primaryAction && (
                      <button
                        class="sn-action sn-action--visible"
                        tabIndex={-1}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleActivate(id);
                        }}
                        title={`${ACTION_LABELS[primaryAction]} (Enter)`}
                      >
                        {"\u23CE"}
                      </button>
                    )}
                  </div>
                );
              })}

              {visibleNodeIds.length === 0 && (
                <div class="sn-empty">
                  {query ? "No matching nodes" : "Empty tree"}
                </div>
              )}
            </div>
          </div>

          <div
            class="sn-keyboard-bar"
            role="toolbar"
            aria-label="Send keyboard events to page"
          >
            <span class="sn-keyboard-label">Send key:</span>
            <button
              class="sn-key-btn"
              onClick={() => handleSendKey("Escape", "Escape", 27)}
              title="Send Escape key"
            >
              Esc
            </button>
            <button
              class="sn-key-btn"
              onClick={() => handleSendKey("Tab", "Tab", 9)}
              title="Send Tab key"
            >
              Tab
            </button>
            <button
              class="sn-key-btn"
              onClick={() => handleSendKey("Tab", "Tab", 9, { shift: true })}
              title="Send Shift+Tab"
            >
              Shift+Tab
            </button>
            <button
              class="sn-key-btn"
              onClick={() => handleSendKey("Enter", "Enter", 13)}
              title="Send Enter key"
            >
              Enter
            </button>
            <button
              class="sn-key-btn"
              onClick={() => handleSendKey(" ", "Space", 32)}
              title="Send Space key"
            >
              Space
            </button>
            <button
              class="sn-key-btn"
              onClick={() => handleSendKey("ArrowDown", "ArrowDown", 40)}
              title="Send Down arrow"
            >
              {"\u2193"}
            </button>
            <button
              class="sn-key-btn"
              onClick={() => handleSendKey("ArrowUp", "ArrowUp", 38)}
              title="Send Up arrow"
            >
              {"\u2191"}
            </button>
          </div>

          <div class="sn-hints">
            <kbd>Enter</kbd> activate &middot; <kbd>Space</kbd> expand &middot;{" "}
            <kbd>Arrow</kbd> navigate &middot; <kbd>DblClick</kbd> scope
          </div>
        </>
      )}

      {/* Live region announcements */}
      {liveAnnouncements.length > 0 && (
        <div class="sn-live-log" role="log" aria-label="Live announcements">
          {liveAnnouncements.map((a) => (
            <div
              key={a.id}
              class={`sn-live-entry ${a.level === "assertive" ? "sn-live-entry--assertive" : ""}`}
            >
              <span class="sn-live-role">{a.role}</span>
              <span class="sn-live-text">{a.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
