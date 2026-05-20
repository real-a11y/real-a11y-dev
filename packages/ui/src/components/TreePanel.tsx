/**
 * Pure rendering component for a pre-extracted semantic tree.
 *
 * Unlike `TreeView`, this component does NOT observe the DOM or extract the
 * tree itself. It accepts an already-extracted `ExtractionResult` and renders
 * it with full interactivity (search, filter, expand/collapse, tab sequence).
 *
 * This is the component used by the Storybook addon manager panel, where the
 * tree data crosses the iframe boundary as serialized JSON and there is no
 * live DOM root to observe.
 *
 * All DOM side-effects (highlight overlay, focus, action dispatch) are proxied
 * back to the caller via optional callbacks rather than being applied here.
 */
import type {
  SemanticNode,
  TreeViewMode,
  RoleFilter,
  ActionType,
  ExtractionResult,
} from "@real-a11y-dev/core";
import {
  applySearchFilter,
  getPrimaryAction,
  buildControlsIndex,
} from "@real-a11y-dev/core";
import {
  useState,
  useMemo,
  useCallback,
  useRef,
  useEffect,
} from "preact/hooks";

import { useInputModality } from "../hooks/useInputModality.js";
import { useSearch } from "../hooks/useSearch.js";
import { useTreeKeyboard } from "../hooks/useTreeKeyboard.js";

import { FilteredList } from "./FilteredList.js";
import { TabSequenceView } from "./TabSequenceView.js";
import { TreeNode } from "./TreeNode.js";
import { TreeToolbar } from "./TreeToolbar.js";

// ─── helpers ─────────────────────────────────────────────────────────────────

function getVisibleNodeIds(
  nodes: Map<string, SemanticNode>,
  rootId: string,
): string[] {
  const result: string[] = [];
  function walk(id: string) {
    const node = nodes.get(id);
    if (!node || !node.ui.matchesFilter) return;
    result.push(id);
    if (node.ui.expanded) {
      for (const childId of node.childIds) walk(childId);
    }
  }
  walk(rootId);
  return result;
}

/**
 * Build the chip data TreeNode renders for cross-link jumps. Pre-resolved
 * here so TreeNode doesn't need access to the nodes Map.
 */
export interface ControlsLink {
  id: string;
  /** "<role> "<name>"" or just "<role>" — what the chip displays. */
  label: string;
  /** True when the link came from the haspopup heuristic, not aria-controls. */
  inferred: boolean;
}

function makeLinkLabel(node: SemanticNode): string {
  const role = node.a11y.role;
  const name = node.a11y.name;
  if (!name) return role;
  const truncated = name.length > 24 ? name.slice(0, 24) + "…" : name;
  return `${role} "${truncated}"`;
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface TreePanelProps {
  /** Pre-extracted tree — updated externally (e.g. from a Storybook channel). */
  treeData: ExtractionResult;
  /** Current view mode — controlled by the caller. */
  viewMode: TreeViewMode;
  /** Called when the user clicks a mode button. */
  onViewModeChange: (mode: TreeViewMode) => void;
  /** Theme — default "auto". */
  theme?: "light" | "dark" | "auto";
  /**
   * Called when a node is selected. Callers use this to apply a highlight
   * overlay on the real DOM element (e.g. via FocusManager or over a channel).
   */
  onSelect?: (nodeId: string, node: SemanticNode) => void;
  /**
   * Called when the primary action for a node should be dispatched. Callers
   * gate on `interactive` / `focusHostOnActivate` before dispatching.
   */
  onActivate?: (nodeId: string, action: ActionType) => void;
  /**
   * Called on tree-node mouse-enter / mouse-leave. Callers use this to toggle
   * the real-DOM highlight overlay.
   */
  onHover?: (nodeId: string | null) => void;
  /** User-facing callback — fired on every node selection. */
  /** User-facing callback — fired on every node selection. */
  onNodeSelect?: (node: SemanticNode) => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function TreePanel({
  treeData,
  viewMode,
  onViewModeChange,
  theme = "auto",
  onSelect,
  onActivate,
  onHover,
  onNodeSelect,
}: TreePanelProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [roleFilter, setRoleFilter] = useState<RoleFilter>(null);
  // Monotonic counter used to invalidate useMemo after in-place node mutations.
  const [renderCount, setRenderCount] = useState(0);
  const forceRender = useCallback(() => setRenderCount((c) => c + 1), []);

  const treeRef = useRef<HTMLDivElement>(null);
  const { query, matchCount, updateQuery, updateMatchCount } = useSearch();

  // aria-controls cross-link index (trigger ↔ controlled element). Used to
  // render clickable jump chips on disclosure pairs (button ↔ menu, tab ↔
  // panel, combobox ↔ listbox) so the relationship is reachable without
  // scroll-hunting.
  const controlsIndex = useMemo(
    () => buildControlsIndex(treeData.nodes),
    [treeData],
  );

  // Tree-node id currently flashing after a cross-link jump. Cleared by a
  // timeout so the flash plays once.
  const [flashingId, setFlashingId] = useState<string | null>(null);

  // Clear role filter when entering tab mode
  useEffect(() => {
    if (viewMode === "tab") setRoleFilter(null);
  }, [viewMode]);

  // Apply search + role filter whenever the data or filter criteria change
  useEffect(() => {
    const count = applySearchFilter(
      treeData.nodes,
      query,
      viewMode,
      roleFilter,
    );
    updateMatchCount(count);
    forceRender();
  }, [query, treeData, viewMode, roleFilter, updateMatchCount, forceRender]);

  // Recompute visible IDs after node mutations (expand/collapse) or data change
  const visibleNodeIds = useMemo(
    () => getVisibleNodeIds(treeData.nodes, treeData.rootId),
    // renderCount changes on every forceRender() call — intentional invalidation.
    [treeData, renderCount],
  );

  // Scroll selected node into view
  useEffect(() => {
    if (!selectedId || !treeRef.current) return;
    const el = treeRef.current.querySelector(`[data-node-id="${selectedId}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleSelect = useCallback(
    (id: string) => {
      setSelectedId(id);
      const node = treeData.nodes.get(id);
      if (node) {
        onNodeSelect?.(node);
        onSelect?.(id, node);
      }
    },
    [treeData, onNodeSelect, onSelect],
  );

  const handleToggle = useCallback(
    (id: string) => {
      const node = treeData.nodes.get(id);
      if (node) {
        node.ui.expanded = !node.ui.expanded;
        forceRender();
      }
    },
    [treeData, forceRender],
  );

  const handleActivate = useCallback(
    (id: string, explicitAction?: ActionType) => {
      const node = treeData.nodes.get(id);
      if (!node) return;
      // The slider/spinbutton ▼/▲ pair passes its own action; everyone
      // else (Enter key, Activate button, action-button click) lets us
      // pick the primary so the existing single-action ergonomics
      // continue to work.
      const action =
        explicitAction ?? getPrimaryAction(node.interaction.actions);
      if (!action) {
        // No action available — toggle expand/collapse instead.
        if (node.childIds.length > 0) handleToggle(id);
        return;
      }
      onActivate?.(id, action);
    },
    [treeData, handleToggle, onActivate],
  );

  const handleJumpToNode = useCallback(
    (targetId: string) => {
      // Expand every collapsed ancestor so the target is in `visibleNodeIds`
      // before we try to scroll to it.
      let cur: SemanticNode | undefined = treeData.nodes.get(targetId);
      let mutated = false;
      while (cur && cur.parentId) {
        const parent = treeData.nodes.get(cur.parentId);
        if (parent && !parent.ui.expanded) {
          parent.ui.expanded = true;
          mutated = true;
        }
        cur = parent;
      }
      if (mutated) forceRender();
      setSelectedId(targetId);
      setFlashingId(targetId);
      setTimeout(() => setFlashingId(null), 700);

      // Two RAFs ensure Preact has rendered AND the browser has done layout
      // accounting for the newly-expanded ancestors before we measure. The
      // selection effect below uses `block: "nearest"`, which can no-op
      // when the row was JUST inserted via ancestor expansion — explicit
      // center-scroll guarantees the target lands in the viewport.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const el = treeRef.current?.querySelector(
            `[data-node-id="${CSS.escape(targetId)}"]`,
          );
          el?.scrollIntoView({ block: "center" });
        });
      });
    },
    [treeData, forceRender],
  );

  const { isMouseModality, markKeyboard } = useInputModality();

  // Hover handlers fire only when the mouse is the active modality.
  // After keyboard nav scrolls the tree, rows shift under a stationary
  // cursor and fire spurious mouseenter events — gating on modality keeps
  // those from clobbering the keyboard's selection on the real page.
  const handleHover = useCallback(
    (id: string | null) => {
      if (!isMouseModality()) return;
      onHover?.(id);
    },
    [onHover, isMouseModality],
  );

  const handleExpandAll = useCallback(() => {
    for (const node of treeData.nodes.values()) {
      if (node.childIds.length > 0) node.ui.expanded = true;
    }
    forceRender();
  }, [treeData, forceRender]);

  const handleCollapseAll = useCallback(() => {
    for (const node of treeData.nodes.values()) {
      if (node.depth > 0) node.ui.expanded = false;
    }
    forceRender();
  }, [treeData, forceRender]);

  const { handleKeyDown } = useTreeKeyboard({
    nodes: treeData.nodes,
    visibleNodeIds,
    selectedId,
    onSelect: handleSelect,
    onToggle: handleToggle,
    onActivate: handleActivate,
  });

  // ── Render ──────────────────────────────────────────────────────────────────

  const themeClass =
    theme === "dark"
      ? "sn-theme-dark"
      : theme === "light"
        ? "sn-theme-light"
        : "sn-theme-auto";

  return (
    <div class={`sn-root ${themeClass}`}>
      <TreeToolbar
        viewMode={viewMode}
        onViewModeChange={onViewModeChange}
        query={query}
        onQueryChange={updateQuery}
        matchCount={matchCount}
        onExpandAll={handleExpandAll}
        onCollapseAll={handleCollapseAll}
        roleFilter={roleFilter}
        onRoleFilterChange={setRoleFilter}
      />
      <div class="sn-tree-container">
        {viewMode === "tab" ? (
          <TabSequenceView
            nodes={treeData.nodes}
            rootId={treeData.rootId}
            query={query}
            onSelect={handleSelect}
            onActivate={handleActivate}
            onHover={handleHover}
          />
        ) : roleFilter ? (
          <FilteredList
            nodes={treeData.nodes}
            roleFilter={roleFilter}
            query={query}
            onSelect={handleSelect}
            onActivate={handleActivate}
          />
        ) : (
          <div
            ref={treeRef}
            class="sn-tree"
            role="tree"
            aria-label="Semantic tree"
            tabIndex={0}
            onKeyDown={(e) => {
              markKeyboard();
              handleKeyDown(e);
            }}
          >
            {visibleNodeIds.map((id) => {
              const node = treeData.nodes.get(id);
              if (!node) return null;
              const forwardIds = controlsIndex.forward.get(id);
              const reverseIds = controlsIndex.reverse.get(id);
              const controlsLinks: ControlsLink[] | undefined =
                forwardIds && forwardIds.length > 0
                  ? (forwardIds
                      .map((targetId) => {
                        const target = treeData.nodes.get(targetId);
                        if (!target) return null;
                        return {
                          id: targetId,
                          label: makeLinkLabel(target),
                          inferred: controlsIndex.inferred.has(id),
                        };
                      })
                      .filter(Boolean) as ControlsLink[])
                  : undefined;
              const controlledByLinks: ControlsLink[] | undefined =
                reverseIds && reverseIds.length > 0
                  ? (reverseIds
                      .map((triggerId) => {
                        const trigger = treeData.nodes.get(triggerId);
                        if (!trigger) return null;
                        return {
                          id: triggerId,
                          label: makeLinkLabel(trigger),
                          inferred: controlsIndex.inferred.has(triggerId),
                        };
                      })
                      .filter(Boolean) as ControlsLink[])
                  : undefined;
              return (
                <TreeNode
                  key={id}
                  node={node}
                  viewMode={viewMode}
                  isSelected={id === selectedId}
                  isFlashing={id === flashingId}
                  onSelect={handleSelect}
                  onToggle={handleToggle}
                  onActivate={handleActivate}
                  onHover={handleHover}
                  controlsLinks={controlsLinks}
                  controlledByLinks={controlledByLinks}
                  onJumpToNode={handleJumpToNode}
                />
              );
            })}
            {visibleNodeIds.length === 0 && (
              <div class="sn-empty">
                {query ? "No matching nodes" : "Empty tree"}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
