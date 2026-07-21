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

import type { TreeDiffView } from "../diff.js";
import { useInputModality } from "../hooks/useInputModality.js";
import { useSearch } from "../hooks/useSearch.js";
import { useTreeKeyboard } from "../hooks/useTreeKeyboard.js";
import { useVirtualTree } from "../hooks/useVirtualTree.js";

import { FilteredList } from "./FilteredList.js";
import { TabSequenceView } from "./TabSequenceView.js";
import { TreeNode } from "./TreeNode.js";
import { TreeToolbar } from "./TreeToolbar.js";

// ─── helpers ─────────────────────────────────────────────────────────────────

/** `aria-posinset`/`aria-setsize` for a row within its visible sibling group. */
interface VisiblePosition {
  posinset: number;
  setsize: number;
}

/**
 * Flatten the tree to the rows that should render, and record each row's
 * position within its visible sibling group. Because the list is virtualized
 * (offscreen rows leave the DOM), screen readers rely on `aria-posinset`/
 * `aria-setsize` to perceive the full tree size and position — the plain
 * sibling inference of a fully-rendered `role="tree"` no longer holds.
 */
function getVisibleNodeIds(
  nodes: Map<string, SemanticNode>,
  rootId: string,
): { ids: string[]; positions: Map<string, VisiblePosition> } {
  const ids: string[] = [];
  const positions = new Map<string, VisiblePosition>();
  function walk(id: string, posinset: number, setsize: number) {
    const node = nodes.get(id);
    if (!node || !node.ui.matchesFilter) return;
    ids.push(id);
    positions.set(id, { posinset, setsize });
    if (node.ui.expanded) {
      const visibleChildren = node.childIds.filter(
        (childId) => nodes.get(childId)?.ui.matchesFilter,
      );
      visibleChildren.forEach((childId, i) => {
        walk(childId, i + 1, visibleChildren.length);
      });
    }
  }
  walk(rootId, 1, 1);
  return { ids, positions };
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
   * Highlight what changed since a captured baseline. Rows present in
   * `treeData` get an added/changed marker; nodes that are gone are summarized
   * below the tree, since they have no row (and no host element) to point at.
   * Omit — or pass an empty view — to render normally.
   */
  diff?: TreeDiffView;
  /** Show the toolbar's checkpoint button, which drives `diff`. */
  enableDiff?: boolean;
  /** True while a baseline is captured — drives the button's pressed state. */
  diffActive?: boolean;
  /** Called when the checkpoint button is clicked (capture / clear). */
  onToggleDiff?: () => void;
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
  onNodeSelect?: (node: SemanticNode) => void;

  // ── DevTools-style element picker ───────────────────────────────────────────
  /**
   * Show the picker toolbar button (⦿) and accept pick events from
   * the caller. Off by default — the picker captures clicks at the
   * document level so opt-in only.
   */
  enablePicker?: boolean;
  /** Current picker state; the panel mirrors this on the button's aria-pressed. */
  pickModeOn?: boolean;
  /** Called when the user clicks the picker button. */
  onTogglePickMode?: () => void;
  /**
   * Most-recent picked nodeId. When this changes, the panel selects the
   * row and scrolls it into view, then calls onPickedNodeHandled so the
   * caller can clear the value (otherwise re-picking the same id would
   * not retrigger).
   */
  pickedNodeId?: string | null;
  /** Called once the panel has applied a pickedNodeId. */
  onPickedNodeHandled?: () => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function TreePanel({
  treeData,
  viewMode,
  onViewModeChange,
  theme = "auto",
  diff,
  enableDiff = false,
  diffActive = false,
  onToggleDiff,
  onSelect,
  onActivate,
  onHover,
  onNodeSelect,
  enablePicker = false,
  pickModeOn = false,
  onTogglePickMode,
  pickedNodeId = null,
  onPickedNodeHandled,
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
  const { ids: visibleNodeIds, positions: visiblePositions } = useMemo(
    () => getVisibleNodeIds(treeData.nodes, treeData.rootId),
    // renderCount changes on every forceRender() call — intentional invalidation.
    [treeData, renderCount],
  );

  // Latest visible list, readable from a rAF callback that runs after an
  // ancestor-expansion re-render has committed (see the picker effect below).
  const visibleNodeIdsRef = useRef(visibleNodeIds);
  visibleNodeIdsRef.current = visibleNodeIds;

  // Virtualize the tree list: render only the rows in the viewport plus overscan.
  const {
    containerRef,
    startIndex,
    endIndex,
    totalHeight,
    offset,
    onScroll,
    scrollToIndex,
  } = useVirtualTree(visibleNodeIds.length);

  // Scroll selected node into view whenever the selection changes. Keyed on
  // `selectedId` only — depending on `visibleNodeIds` would re-fire on every
  // expand/collapse and yank the viewport back to an off-screen selection. The
  // list is read from a ref so the index resolves against the post-expansion
  // list without adding it as a dependency. (Re-selecting the same off-screen
  // node is handled explicitly where it can happen: the picker effect below
  // and `handleJumpToNode`.)
  useEffect(() => {
    if (!selectedId) return;
    const index = visibleNodeIdsRef.current.indexOf(selectedId);
    if (index !== -1) scrollToIndex(index, "nearest");
  }, [selectedId, scrollToIndex]);

  // When the picker reports a picked element, surface it as a tree
  // selection: expand ancestors so the row is visible, set selectedId,
  // scroll into view, and acknowledge so the caller can clear the
  // value (otherwise re-picking the same node wouldn't retrigger).
  useEffect(() => {
    if (!pickedNodeId) return;
    const node = treeData.nodes.get(pickedNodeId);
    if (!node) {
      onPickedNodeHandled?.();
      return;
    }
    let cur: SemanticNode | undefined = node;
    let mutated = false;
    while (cur?.parentId) {
      const parent = treeData.nodes.get(cur.parentId);
      if (parent && !parent.ui.expanded) {
        parent.ui.expanded = true;
        mutated = true;
      }
      cur = parent;
    }
    if (mutated) forceRender();
    setSelectedId(pickedNodeId);
    // Scroll the picked row into view on every pick — including a re-pick of an
    // already-selected, already-expanded node that the user has since scrolled
    // away from. In that case neither `selectedId` nor `visibleNodeIds` change,
    // so the selection effect above never re-runs; with virtualization the row
    // may also be unmounted, so we scroll by index explicitly. The rAF lets any
    // ancestor-expansion re-render commit (refreshing `visibleNodeIdsRef`) first.
    //
    // Deliberately NOT cancelled on cleanup: acknowledging the pick clears
    // `pickedNodeId`, which re-runs this effect, and a cleanup-based
    // cancelAnimationFrame would then race the scroll (and often cancel it). The
    // one-shot frame is harmless after unmount because scrollToIndex no-ops when
    // the container ref is null.
    requestAnimationFrame(() => {
      const index = visibleNodeIdsRef.current.indexOf(pickedNodeId);
      if (index !== -1) scrollToIndex(index, "nearest");
    });
    onPickedNodeHandled?.();
  }, [pickedNodeId, treeData, forceRender, onPickedNodeHandled, scrollToIndex]);

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
      // Scroll the target into view even when it is already the selection (a
      // chip can point back at the current node); the selectedId-keyed effect
      // won't re-run in that case. The rAF lets any ancestor-expansion
      // re-render commit (refreshing `visibleNodeIdsRef`) first.
      requestAnimationFrame(() => {
        const index = visibleNodeIdsRef.current.indexOf(targetId);
        if (index !== -1) scrollToIndex(index, "nearest");
      });
    },
    [treeData, forceRender, scrollToIndex],
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

  // Only the tree branch below renders virtualized rows. Attaching the
  // measurement ref / scroll handler while the tab or filtered views own the
  // container would just re-render scroll state nobody reads (the hook
  // re-measures when the ref re-attaches on the way back).
  const isTreeBranch = viewMode !== "tab" && !roleFilter;

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
        enablePicker={enablePicker}
        pickModeOn={pickModeOn}
        onTogglePickMode={onTogglePickMode}
        enableDiff={enableDiff}
        diffActive={diffActive}
        onToggleDiff={onToggleDiff}
      />
      <div
        ref={isTreeBranch ? containerRef : undefined}
        class="sn-tree-container"
        onScroll={isTreeBranch ? onScroll : undefined}
      >
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
            style={{
              minHeight: totalHeight,
              paddingTop: offset,
              boxSizing: "border-box",
            }}
            onKeyDown={(e) => {
              markKeyboard();
              handleKeyDown(e);
            }}
          >
            {visibleNodeIds.slice(startIndex, endIndex).map((id) => {
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
              const position = visiblePositions.get(id);
              return (
                <TreeNode
                  key={id}
                  node={node}
                  viewMode={viewMode}
                  isSelected={id === selectedId}
                  isFlashing={id === flashingId}
                  diffStatus={diff?.status.get(id)}
                  diffColumn={diff !== undefined}
                  posinset={position?.posinset}
                  setsize={position?.setsize}
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
        {diff && diff.removed.length > 0 && (
          <RemovedNodes nodes={diff.removed} />
        )}
      </div>
    </div>
  );
}

/** Cap the rendered list — a large teardown shouldn't produce a wall of rows. */
const MAX_REMOVED_SHOWN = 50;

/**
 * Nodes that existed at the checkpoint and are gone now. They get no tree row:
 * their elements have left the DOM, so there is nothing to select, highlight,
 * or act on. A native `<details>` carries the disclosure semantics — no
 * `aria-expanded`/`aria-controls` bookkeeping, and no duplicate-id hazard when
 * two panels are mounted at once.
 */
function RemovedNodes({ nodes }: { nodes: SemanticNode[] }) {
  const shown = nodes.slice(0, MAX_REMOVED_SHOWN);
  return (
    <details class="sn-removed">
      <summary class="sn-removed-summary">
        {nodes.length} removed since checkpoint
      </summary>
      <ul class="sn-removed-list">
        {shown.map((node) => (
          <li key={node.id} class="sn-removed-item">
            {node.a11y.role}
            {node.a11y.name ? ` "${node.a11y.name}"` : ""}
          </li>
        ))}
        {nodes.length > shown.length && (
          <li class="sn-removed-item sn-removed-item--more">
            … and {nodes.length - shown.length} more
          </li>
        )}
      </ul>
    </details>
  );
}
