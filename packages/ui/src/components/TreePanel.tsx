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
  DomSemanticNode,
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

import { JUMP_KEYSHORTCUTS } from "../hooks/jumpKeys.js";
import { useIndexById } from "../hooks/useIndexById.js";
import { useInputModality } from "../hooks/useInputModality.js";
import { treeRowDomId, useInstanceId } from "../hooks/useInstanceId.js";
import { usePanelChanges } from "../hooks/usePanelChanges.js";
import { useSearch } from "../hooks/useSearch.js";
import { useHiddenChanges } from "../hooks/useTreeChanges.js";
import { useTreeKeyboard } from "../hooks/useTreeKeyboard.js";
import { useVirtualTree } from "../hooks/useVirtualTree.js";
import { isEmptyTreeChanges } from "../tree-changes-diff.js";
import {
  CHANGE_KEYSHORTCUTS,
  isChangeKey,
  rowChangeMarks,
  type TreeChangesProp,
} from "../tree-changes.js";

import { getVisibleNodeIds } from "../visible-rows.js";

import { FilteredList } from "./FilteredList.js";
import { TabSequenceView } from "./TabSequenceView.js";
import { ChangeNoticeRegion, TreeChangesBar } from "./TreeChangesBar.js";
import { TreeNode } from "./TreeNode.js";
import { TreeToolbar } from "./TreeToolbar.js";

// ─── helpers ─────────────────────────────────────────────────────────────────

/**
 * The panel only ever renders DOM-produced trees, so every node carries all
 * facets. Narrow a looked-up node to {@link DomSemanticNode} at read sites
 * that need `dom` / `interaction` / `ui` (the `nodes` Map itself stays
 * `SemanticNode`-typed so it can still be passed to core helpers).
 */
const asDom = (n: SemanticNode | undefined): DomSemanticNode | undefined =>
  n as DomSemanticNode | undefined;

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
   * What changed in the tree, marked on its rows (`tree-changes.ts`): a new
   * or changed row keeps a coloured edge and flashes as it comes, tags say
   * what changed, a bar under the tree sums it up and lists the rows
   * removed, which have no row (and no element) left to mark, Alt+N goes
   * from change to change, and what a change the user caused found is said.
   * `TreeView` hands it what each update of a live tree found, or all of it
   * since the checkpoint. Left out, nothing is marked.
   */
  changes?: TreeChangesProp;
  /** Show the toolbar's checkpoint button, which pins what `changes` are
   *  compared with. */
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

  // ── Settings ────────────────────────────────────────────────────────────────
  /**
   * Whether the tree starts out showing names in full, rather than ending a
   * long one in an ellipsis. Default `false`. Read when the panel mounts:
   * after that it is the user's, from the toolbar's Settings.
   */
  defaultShowFullNames?: boolean;
  /**
   * Whether the tree shows names in full now, for a caller that keeps the
   * choice itself, as the inspector does for every panel on a page. When
   * set, the tree and the switch follow it rather than the panel's own state.
   * The switch reports a change through `onShowFullNamesChange`, for the
   * caller to pass back, and without one Settings has no switch.
   */
  showFullNames?: boolean;
  /**
   * Called when the user turns "Show full names" on or off, so a caller that
   * remounts the panel can pass the choice back as `defaultShowFullNames`.
   */
  onShowFullNamesChange?: (showFullNames: boolean) => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function TreePanel({
  treeData,
  viewMode,
  onViewModeChange,
  theme = "auto",
  changes,
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
  defaultShowFullNames = false,
  showFullNames: shownFullNames,
  onShowFullNamesChange,
}: TreePanelProps) {
  // Keeps row/option DOM ids unique when two panels share a light-DOM document
  // — aria-activedescendant is a document-wide IDREF.
  const instanceId = useInstanceId();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [roleFilter, setRoleFilter] = useState<RoleFilter>(null);
  const [ownShowFullNames, setShowFullNames] = useState(defaultShowFullNames);
  const showFullNames = shownFullNames ?? ownShowFullNames;
  // A change always renders again, so a switch whose caller keeps the choice
  // shows the caller's value even when its own state didn't move.
  const [, setChanges] = useState(0);
  const handleShowFullNamesChange = useCallback(
    (on: boolean) => {
      setShowFullNames(on);
      setChanges((n) => n + 1);
      onShowFullNamesChange?.(on);
    },
    [onShowFullNamesChange],
  );
  // Monotonic counter used to invalidate useMemo after in-place node mutations.
  const [renderCount, setRenderCount] = useState(0);
  const forceRender = useCallback(() => setRenderCount((c) => c + 1), []);

  const treeRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const { query, matchCount, updateQuery, updateMatchCount } = useSearch();

  const focusSearch = useCallback(() => {
    searchInputRef.current?.focus();
  }, []);

  // aria-controls cross-link index (trigger ↔ controlled element). Used to
  // render clickable jump chips on disclosure pairs (button ↔ menu, tab ↔
  // panel, combobox ↔ listbox) so the relationship is reachable without
  // scroll-hunting.
  const controlsIndex = useMemo(
    () => buildControlsIndex(treeData.nodes),
    [treeData],
  );

  // Chip data per row, resolved once per tree rather than rebuilt inside the
  // render loop. The arrays used to be constructed inline for every rendered
  // row on every render — so each arrow keypress, flash timeout and
  // forceRender re-ran `nodes.get` + `makeLinkLabel` for every link on screen
  // and handed TreeNode fresh array identities. Only rows that actually have a
  // link get an entry, so this walks the cross-link index, not the whole tree.
  // Safe to key on the tree alone: labels read `a11y.role`/`a11y.name`, which
  // the panel never mutates in place (it only touches `ui.*`).
  const controlsLinksById = useMemo(() => {
    const resolve = (ids: string[], inferredFrom: (id: string) => boolean) => {
      const links: ControlsLink[] = [];
      for (const id of ids) {
        const target = treeData.nodes.get(id);
        if (!target) continue;
        links.push({
          id,
          label: makeLinkLabel(target),
          inferred: inferredFrom(id),
        });
      }
      return links.length > 0 ? links : undefined;
    };

    const byId = new Map<
      string,
      { controls?: ControlsLink[]; controlledBy?: ControlsLink[] }
    >();
    for (const [rowId, forwardIds] of controlsIndex.forward) {
      const controls = resolve(forwardIds, () =>
        controlsIndex.inferred.has(rowId),
      );
      if (controls) byId.set(rowId, { controls });
    }
    for (const [rowId, reverseIds] of controlsIndex.reverse) {
      const controlledBy = resolve(reverseIds, (triggerId) =>
        controlsIndex.inferred.has(triggerId),
      );
      if (!controlledBy) continue;
      const existing = byId.get(rowId);
      if (existing) existing.controlledBy = controlledBy;
      else byId.set(rowId, { controlledBy });
    }
    return byId;
  }, [treeData, controlsIndex]);

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

  // What the last update found changed, marked on the rows (`changes`). A
  // jump to a change reaches the row as a chip's jump does, through a
  // handler defined below: read at the time of the jump.
  const jumpRef = useRef<(id: string) => void>(() => {});
  const jumpToChange = useCallback((id: string) => jumpRef.current(id), []);
  const marks = usePanelChanges({
    treeData,
    renderCount,
    forceRender,
    changes,
    selectedId,
    jumpTo: jumpToChange,
  });
  const { goToChange } = marks.view;

  // Recompute visible IDs after node mutations (expand/collapse) or data change
  const { ids: visibleNodeIds, positions: visiblePositions } = useMemo(
    () => getVisibleNodeIds(treeData.nodes, treeData.rootId, marks.open),
    // renderCount changes on every forceRender() call — intentional invalidation.
    [treeData, renderCount, marks.open],
  );
  const hidden = useHiddenChanges(marks.view, visibleNodeIds, marks.parentOf);

  // Row id → position, so resolving the selection to an index (for
  // aria-activedescendant, scroll-into-view, and every pick/jump) is a lookup
  // rather than a scan of the whole visible list.
  const visibleIndexById = useIndexById(visibleNodeIds);

  // Latest index map, readable from a rAF callback that runs after an
  // ancestor-expansion re-render has committed (see the picker effect below),
  // so those callbacks resolve against the post-expansion list without taking
  // a dependency on it.
  const visibleIndexByIdRef = useRef(visibleIndexById);
  visibleIndexByIdRef.current = visibleIndexById;

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

  // aria-activedescendant may only point at a DOM-present row. Offscreen
  // virtualized rows are unmounted, so require the selection to sit in the
  // current window (keyboard selection scrolls it in via scrollToIndex).
  // Prefixed with instanceId so a second panel's reference can't resolve here.
  const activeDescendantId = (() => {
    if (selectedId === null) return undefined;
    const i = visibleIndexById.get(selectedId) ?? -1;
    return i >= startIndex && i < endIndex
      ? treeRowDomId(instanceId, selectedId)
      : undefined;
  })();

  // Scroll selected node into view whenever the selection changes. Keyed on
  // `selectedId` only — depending on `visibleNodeIds` would re-fire on every
  // expand/collapse and yank the viewport back to an off-screen selection. The
  // list is read from a ref so the index resolves against the post-expansion
  // list without adding it as a dependency. (Re-selecting the same off-screen
  // node is handled explicitly where it can happen: the picker effect below
  // and `handleJumpToNode`.)
  useEffect(() => {
    if (!selectedId) return;
    const index = visibleIndexByIdRef.current.get(selectedId) ?? -1;
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
    let cur: DomSemanticNode | undefined = asDom(node);
    let mutated = false;
    while (cur?.parentId) {
      const parent = asDom(treeData.nodes.get(cur.parentId));
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
    // ancestor-expansion re-render commit (refreshing `visibleIndexByIdRef`) first.
    //
    // Deliberately NOT cancelled on cleanup: acknowledging the pick clears
    // `pickedNodeId`, which re-runs this effect, and a cleanup-based
    // cancelAnimationFrame would then race the scroll (and often cancel it). The
    // one-shot frame is harmless after unmount because scrollToIndex no-ops when
    // the container ref is null.
    requestAnimationFrame(() => {
      const index = visibleIndexByIdRef.current.get(pickedNodeId) ?? -1;
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
      const node = asDom(treeData.nodes.get(id));
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
        explicitAction ?? getPrimaryAction(node.interaction!.actions);
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
      let cur: DomSemanticNode | undefined = asDom(
        treeData.nodes.get(targetId),
      );
      let mutated = false;
      while (cur && cur.parentId) {
        const parent = asDom(treeData.nodes.get(cur.parentId));
        if (parent && !parent.ui.expanded) {
          parent.ui.expanded = true;
          mutated = true;
        }
        cur = parent;
      }
      if (mutated) forceRender();
      // A row a search or role filter hides is not in the visible list, so
      // the selection would point at nothing a keyboard or screen reader can
      // reach: clear the filters, as the extension's native tree does.
      if (asDom(treeData.nodes.get(targetId))?.ui.matchesFilter === false) {
        updateQuery("");
        setRoleFilter(null);
      }
      // Through the ordinary selection path, so `onSelect` / `onNodeSelect`
      // hear about a jump as they do about any other selection.
      handleSelect(targetId);
      setFlashingId(targetId);
      setTimeout(() => setFlashingId(null), 700);
      // Scroll the target into view even when it is already the selection (a
      // chip can point back at the current node); the selectedId-keyed effect
      // won't re-run in that case. The rAF lets any ancestor-expansion
      // re-render commit (refreshing `visibleIndexByIdRef`) first.
      requestAnimationFrame(() => {
        const index = visibleIndexByIdRef.current.get(targetId) ?? -1;
        if (index !== -1) scrollToIndex(index, "nearest");
      });
    },
    [treeData, forceRender, scrollToIndex, handleSelect, updateQuery],
  );
  jumpRef.current = handleJumpToNode;
  const jumpKeys = useMemo(
    () => ({ links: controlsIndex, onJump: handleJumpToNode }),
    [controlsIndex, handleJumpToNode],
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
    for (const node of treeData.nodes.values() as IterableIterator<DomSemanticNode>) {
      if (node.childIds.length > 0) node.ui.expanded = true;
    }
    forceRender();
  }, [treeData, forceRender]);

  const handleCollapseAll = useCallback(() => {
    for (const node of treeData.nodes.values() as IterableIterator<DomSemanticNode>) {
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
    onFocusSearch: focusSearch,
    jump: jumpKeys,
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
        searchInputRef={searchInputRef}
        showFullNames={showFullNames}
        // No switch where it could change nothing: a caller that keeps the
        // choice and takes no change back.
        onShowFullNamesChange={
          shownFullNames === undefined || onShowFullNamesChange
            ? handleShowFullNamesChange
            : undefined
        }
      />
      {changes && <ChangeNoticeRegion notice={marks.view.notice} />}
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
            onFocusSearch={focusSearch}
          />
        ) : roleFilter ? (
          <FilteredList
            nodes={treeData.nodes}
            roleFilter={roleFilter}
            query={query}
            onSelect={handleSelect}
            onActivate={handleActivate}
            onFocusSearch={focusSearch}
          />
        ) : (
          <div
            ref={treeRef}
            class={`sn-tree${showFullNames ? " sn-tree--full-names" : ""}`}
            role="tree"
            aria-label="Semantic tree"
            aria-keyshortcuts={
              changes
                ? `${JUMP_KEYSHORTCUTS} ${CHANGE_KEYSHORTCUTS}`
                : JUMP_KEYSHORTCUTS
            }
            tabIndex={0}
            style={{
              minHeight: totalHeight,
              paddingTop: offset,
              boxSizing: "border-box",
            }}
            // Focus stays on this container (rows are non-focusable divs), so
            // the active row must be announced via aria-activedescendant — else
            // arrowing only flips aria-selected on rows the screen reader isn't
            // looking at. Point it at the selected row only while that row is
            // in the virtualized window (offscreen rows are not in the DOM).
            aria-activedescendant={activeDescendantId}
            onKeyDown={(e) => {
              markKeyboard();
              // The next or previous change, as the changes bar's arrows go.
              if (changes && isChangeKey(e)) {
                e.preventDefault();
                goToChange(e.shiftKey);
                return;
              }
              handleKeyDown(e);
            }}
          >
            {visibleNodeIds.slice(startIndex, endIndex).map((id) => {
              const node = asDom(treeData.nodes.get(id));
              if (!node) return null;
              const links = controlsLinksById.get(id);
              const position = visiblePositions.get(id);
              return (
                <TreeNode
                  key={id}
                  node={node}
                  viewMode={viewMode}
                  isSelected={id === selectedId}
                  isFlashing={id === flashingId}
                  expanded={marks.open?.has(id)}
                  changeMarks={
                    changes &&
                    rowChangeMarks(marks.view.shown, hidden, marks.parentOf, id)
                  }
                  changeFlash={marks.view.flashes.get(id)}
                  changesSince={changes?.since}
                  posinset={position?.posinset}
                  setsize={position?.setsize}
                  onSelect={handleSelect}
                  onToggle={handleToggle}
                  onActivate={handleActivate}
                  onHover={handleHover}
                  controlsLinks={links?.controls}
                  controlledByLinks={links?.controlledBy}
                  onJumpToNode={handleJumpToNode}
                  idPrefix={instanceId}
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
      {/* In every view, as the counts and the rows removed hold for all of
          them; its arrows only in the tree, whose rows they go to. */}
      {marks.view.shown && !isEmptyTreeChanges(marks.view.shown) && (
        <TreeChangesBar
          changes={marks.view.shown}
          onPrevious={isTreeBranch ? () => goToChange(true) : undefined}
          onNext={isTreeBranch ? () => goToChange(false) : undefined}
          // The bar goes with the marks, and focus to the tree rather than
          // with the bar.
          onClear={() => {
            changes?.clear();
            treeRef.current?.focus();
          }}
          since={changes?.since}
        />
      )}
    </div>
  );
}
