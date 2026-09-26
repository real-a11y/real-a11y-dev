/**
 * The native producer's tree view (dev-only dogfood build — RFC PR H/#229's
 * production-panel integration). Renders Chromium's own accessibility tree,
 * read over `chrome.debugger`, as a real expand/collapse `role="tree"` —
 * `DogfoodPanel.tsx`'s flat depth-indented list never needed one, but this
 * is the production panel's tree, so it gets the same tree semantics the DOM
 * producer's view already has (see `App.tsx`'s own tree block).
 *
 * Deliberately its own component with its OWN inline row rendering, not a
 * `TreePanel`/`TreeNode` (`@real-a11y-dev/semantic-navigator-ui`) consumer —
 * matching `App.tsx`'s existing pattern for its DOM tree, which forks its own
 * rendering for the same reason (`TreeNode` requires a fully DOM-faceted
 * `DomSemanticNode` unconditionally; a native node has no `dom`/`interaction`
 * facets to give it). A convergence of the two tree renderers is future work,
 * out of scope here — see CLAUDE.md's "Two producers build the tree".
 *
 * Reuses the DOM tree's own CSS classes (`.sn-tree`, `.sn-node`, `.sn-label`,
 * `.sn-state-badge`, …) from `@ui-styles/tree.css` so the two producers look
 * like one tool, not two — only the row's internal JSX differs, not its
 * visual language.
 *
 * Self-contained: owns its own expand/collapse set, selection, keyboard nav,
 * search/role-filter (`native-search.ts`) and virtualization. `App.tsx` owns
 * only the data (the last successful `NATIVE_READ`), the capability banner
 * inputs, and what an activation DISPATCHES (`onActivate`) — the same
 * division `TabSequenceView`/`FilteredList` already use for the DOM
 * producer's alternate views. Search/filter state stays local rather than
 * lifted to `App.tsx` for the same reason: it's a native-only view concern,
 * and it naturally resets when the user switches back to the DOM producer
 * and this component unmounts.
 */

import {
  getPrimaryAction,
  ROLE_FILTER_LABELS,
  type ActionType,
  type RoleFilter,
} from "@real-a11y-dev/core";
import { useVirtualTree } from "@real-a11y-dev/semantic-navigator-ui";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "preact/hooks";

import {
  explainUnavailable,
  type TabCapability,
} from "../native/capability.js";
import {
  ACTABLE,
  isSelectableRole,
  isSteppableRole,
  isTypableRole,
  nativeParentIndex,
  type NativeNode,
} from "../native/native-actions.js";
import { searchNativeTree } from "../native/native-search.js";

import {
  describeStates,
  FilteredListView,
  type FilteredListItem,
} from "./FilteredList.js";

const ROLE_FILTER_KEYS = Object.keys(ROLE_FILTER_LABELS) as Array<
  Exclude<RoleFilter, null>
>;

export interface NativeTreeViewProps {
  nodes: Map<string, NativeNode>;
  rootId: string;
  busy: boolean;
  /** Set only while native cannot attach here — see `capability.ts`. */
  capability: TabCapability | undefined;
  /** One line: node count on success, or an error/refusal description. */
  status: string;
  onRefresh: () => void;
  onActivate: (
    node: NativeNode,
    explicitAction?: "increment" | "decrement" | "select",
  ) => void;
  /**
   * A native pick just resolved to this node id. `nonce` changes on every
   * pick result (even a repeated pick of the same node) so the effect below
   * fires again rather than bailing out on an unchanged `nodeId` — a plain
   * `useEffect([reveal?.nodeId])` would silently no-op on "pick the same row
   * twice in a row."
   */
  reveal?: {
    nodeId: string;
    /**
     * Nearest-first fallback chain — the picked node's own DOM ancestors —
     * for when `nodeId` itself was never kept in the AX tree (an unnamed
     * wrapper, padding inside a labelled group). Tried in order; the first
     * one present in `nodes` wins.
     */
    ancestorIds?: string[];
    nonce: number;
  };
  /**
   * Best-effort: the user settled on this node id as the tree's selection
   * (click, arrow-key nav, pick-reveal, or the filtered list's "go to
   * tree") — App.tsx moves real page focus there, mirroring what the DOM
   * tree's own row selection already does. Optional so a test/host that
   * doesn't care about page-side effects can omit it.
   */
  onSelectionFocus?: (nodeId: string) => void;
}

/** A node is worth a click/Enter action, a select action, or both never — the
 *  same three-way split `DogfoodPanel.tsx` renders from, reused here so a
 *  fix to one never silently diverges from the other. */
function primaryLabel(node: NativeNode): string | undefined {
  if (isTypableRole(node.role, node.states)) return "Type";
  if (isSelectableRole(node.role)) return "Select";
  if (ACTABLE.has(node.role)) return "Click";
  return undefined;
}

/** What a native row can do, in `interaction.actions`' vocabulary, so the
 *  shared filtered list can decide Enter/Activate and the stepper keys the
 *  same way it does for a DOM row. Mirrors `primaryLabel`'s precedence. */
function nativeActions(node: NativeNode): ActionType[] {
  const actions: ActionType[] = [];
  if (isTypableRole(node.role, node.states)) actions.push("type");
  else if (isSelectableRole(node.role)) actions.push("select");
  else if (ACTABLE.has(node.role)) actions.push("click");
  if (isSteppableRole(node.role)) actions.push("increment", "decrement");
  return actions;
}

function toListItem(node: NativeNode): FilteredListItem {
  const level = parseInt(node.properties?.["level"] ?? "", 10);
  return {
    id: node.id,
    label: node.name || `(${node.role})`,
    level: Number.isNaN(level) ? undefined : level,
    states: describeStates(node.states),
    actions: nativeActions(node),
  };
}

export function NativeTreeView({
  nodes,
  rootId,
  busy,
  capability,
  status,
  onRefresh,
  onActivate,
  reveal,
  onSelectionFocus,
}: NativeTreeViewProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Seed a sensible default the first time THIS root shows up — root plus its
  // immediate children expanded, so the page's landmark structure is visible
  // without an extra click, deeper content collapsed. `rootId` is stable
  // across repeated reads of the same document (native ids encode Chromium's
  // own `backendDOMNodeId`, which only changes on navigation) and changes
  // after a real navigation — so this fires once per document, not once per
  // re-read, and never fights the user's own expand/collapse choices on an
  // action-triggered refresh of the SAME page.
  // Layout effect, not a plain effect: a plain effect runs AFTER the browser
  // paints, so the very first render of a new root would briefly paint just
  // that one collapsed row before this seeds its children in and repaints —
  // a one-frame flash on every tree load. Synchronous, pre-paint seeding
  // avoids it.
  useLayoutEffect(() => {
    if (!rootId) return;
    setExpanded((prev) => {
      if (prev.has(rootId)) return prev;
      const root = nodes.get(rootId);
      return new Set([rootId, ...(root?.childIds ?? [])]);
    });
    // Only re-seed when the root identity itself changes — reading `nodes`
    // fresh inside the effect (rather than depending on it) is deliberate:
    // it must NOT re-seed just because the tree refreshed with the same root.
  }, [rootId]);

  const parentOf = useMemo(() => nativeParentIndex(nodes), [nodes]);

  // A pick result lands here from App.tsx's own message handler. Expand every
  // ancestor of the picked node (it may be nested under rows the user never
  // opened) and select it — clearing any active search/role filter first,
  // since a filter that doesn't match the picked node would otherwise hide it
  // and the selection effect below would immediately drop it again (see that
  // effect's own "gone from the current tree" comment).
  useEffect(() => {
    if (!reveal) return;
    // The exact hit-tested node may not itself be one the AX tree kept — an
    // unnamed wrapper `<span>`, padding inside a labelled group. Fall back
    // to the nearest ancestor that IS present, same as the DOM picker's own
    // `resolveTracked` walking `.parentElement` for the identical reason.
    const nodeId = [reveal.nodeId, ...(reveal.ancestorIds ?? [])].find((id) =>
      nodes.has(id),
    );
    if (nodeId === undefined) return;
    setQuery("");
    setRoleFilter(null);
    setExpanded((prev) => {
      const next = new Set(prev);
      for (let id = parentOf.get(nodeId); id; id = parentOf.get(id)) {
        next.add(id);
      }
      return next;
    });
    setSelectedId(nodeId);
    // Clearing the role filter above swaps `FilteredListView` back for the
    // actual tree — an async Preact re-render, not something the
    // `setRoleFilter(null)` call itself finishes — so `treeRef.current` is
    // still null (or stale) here when a filter was active a moment ago.
    // Same double-`requestAnimationFrame` defer `goToTree` above already
    // uses for the identical filtered-list-to-tree transition.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => treeRef.current?.focus());
    });
    // Only re-run on a new pick (`nonce`), not on every `nodes`/`parentOf`
    // change a background refresh causes.
  }, [reveal?.nonce]);

  const hasFilter = query.trim().length > 0 || roleFilter !== null;

  // Same shape as `applySearchFilter`'s result for the DOM producer, minus
  // the mutation — see `native-search.ts` for why. Only actually walks
  // `nodes` when a filter is active (`searchNativeTree` short-circuits to an
  // empty result otherwise), so an untouched search box costs nothing here.
  const search = useMemo(
    () => searchNativeTree(nodes, parentOf, query, roleFilter),
    [nodes, parentOf, query, roleFilter],
  );

  // With a role filter on, show the same flat list the DOM producer does
  // (`FilteredList`) instead of the tree: every direct match, in document
  // order. A pre-order walk from the root, not `nodes`' own iteration order,
  // because that's what "document order" means for this tree. The query
  // still narrows it, through the same `directIds` the match count reports.
  const listItems = useMemo(() => {
    if (roleFilter === null) return [];
    const items: FilteredListItem[] = [];
    const stack = rootId ? [rootId] : [];
    while (stack.length > 0) {
      const id = stack.pop()!;
      const node = nodes.get(id);
      if (!node) continue;
      if (search.directIds.has(id)) items.push(toListItem(node));
      const children = node.childIds ?? [];
      for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]!);
    }
    return items;
  }, [nodes, rootId, roleFilter, search]);

  // `visiblePositions` records each row's aria-posinset/aria-setsize within
  // its visible sibling group — mirrors App.tsx's own identical computation
  // for the DOM tree. Virtualization keeps only the windowed rows in the
  // DOM, so a screen reader needs these explicit set markers to perceive the
  // tree's full size and a row's position in it (WAI-ARIA TreeView); without
  // them a virtualized native row is indistinguishable from a plain child.
  //
  // A filter restricts the walk to matches and their ancestors — same design
  // as the DOM producer's own tree (App.tsx's `visibleNodeIds`): descending
  // still requires `expanded`, so a match under a collapsed ancestor stays
  // hidden until the user expands it by hand. That is a real limitation
  // there too (both producers seed only two levels open by default — see
  // this file's own layout-effect comment, and `dom-extractor.ts`'s
  // `expanded: depth < 2`) rather than something native does worse.
  const { visibleIds, visiblePositions } = useMemo(() => {
    const ids: string[] = [];
    const positions = new Map<string, { posinset: number; setsize: number }>();
    function walk(id: string, posinset: number, setsize: number) {
      const node = nodes.get(id);
      if (!node) return;
      if (hasFilter && !search.visibleIds.has(id)) return;
      ids.push(id);
      positions.set(id, { posinset, setsize });
      if (expanded.has(id)) {
        const children = (node.childIds ?? []).filter(
          (childId) => !hasFilter || search.visibleIds.has(childId),
        );
        children.forEach((childId, i) => walk(childId, i + 1, children.length));
      }
    }
    if (rootId) walk(rootId, 1, 1);
    return { visibleIds: ids, visiblePositions: positions };
  }, [nodes, rootId, expanded, hasFilter, search]);

  const {
    containerRef,
    startIndex,
    endIndex,
    totalHeight,
    offset,
    onScroll,
    scrollToIndex,
  } = useVirtualTree(visibleIds.length);

  useEffect(() => {
    if (!selectedId) return;
    const index = visibleIds.indexOf(selectedId);
    if (index === -1) {
      // The selected id is gone from the current tree (a refresh dropped it,
      // or its parent collapsed away). Leaving `selectedId` pointing at a
      // node no longer in `visibleIds` doesn't just skip this scroll — every
      // branch of handleKeyDown below bails out the same way on a -1 index,
      // so the WHOLE keyboard interface goes dead until the user clicks a
      // row with the mouse. Clearing it instead drops into handleKeyDown's
      // "no selection" branch, which re-selects the first visible row on the
      // next Arrow/Home press.
      setSelectedId(null);
      return;
    }
    scrollToIndex(index, "nearest");
  }, [selectedId, visibleIds, scrollToIndex]);

  // Best-effort: follow the selection onto the real page, the same visible
  // indicator the DOM tree's own row selection already gives — a native
  // node has no light-DOM element this component can call `.focus()` on
  // directly, so it hands the id up to App.tsx, which dispatches a native
  // `focus` action over `chrome.debugger` (see that callback's own comment
  // for why it's a plain fire-and-forget, not the heavier action pipeline).
  //
  // Debounced, deliberately: every branch of handleKeyDown below can walk
  // `selectedId` through several rows within one key-repeat burst, and each
  // dispatch is a real attach→resolve→focus→detach round trip — firing one
  // per intermediate row would queue that whole cycle behind a selection the
  // user has already moved past. Only the row they actually settle on gets
  // the real page's focus.
  //
  // `onSelectionFocus` deliberately stays OUT of the effect's own dependency
  // array — read through a ref instead. A Devin Review finding caught the
  // bug this avoids: App.tsx's callback depends on `nativeBusy`/`curtainOn`,
  // so its identity changes whenever EITHER flips, with `selectedId`
  // completely unchanged (e.g. a native action settling after dispatch, or
  // toggling the curtain). Listing it as a dependency re-armed the debounce
  // on every such change and refired a focus dispatch for the SAME row —
  // concretely, selecting a button, activating it, and having the resulting
  // dialog's own autofocus get immediately stolen back once `nativeBusy`
  // cleared. This effect must fire only when the SELECTION itself changes.
  const onSelectionFocusRef = useRef(onSelectionFocus);
  onSelectionFocusRef.current = onSelectionFocus;
  useEffect(() => {
    if (!selectedId) return;
    const timer = setTimeout(() => {
      onSelectionFocusRef.current?.(selectedId);
    }, 150);
    return () => clearTimeout(timer);
  }, [selectedId]);

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    const all = new Set<string>();
    for (const node of nodes.values()) {
      if ((node.childIds?.length ?? 0) > 0) all.add(node.id);
    }
    setExpanded(all);
  }, [nodes]);

  const collapseAll = useCallback(() => {
    setExpanded(rootId ? new Set([rootId]) : new Set());
  }, [rootId]);

  // The list's "go to tree" (Enter/double-click on a heading, landmark or
  // image): drop the role filter, open every ancestor so the row is actually
  // rendered, select it and hand focus to the tree — the same steps
  // `App.tsx`'s `handleGoToTree` takes for the DOM producer. The selection
  // effect above scrolls it into view once the tree has rendered.
  const goToTree = useCallback(
    (id: string) => {
      setRoleFilter(null);
      setExpanded((prev) => {
        const next = new Set(prev);
        for (let p = parentOf.get(id); p; p = parentOf.get(p)) next.add(p);
        return next;
      });
      setSelectedId(id);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => treeRef.current?.focus());
      });
    },
    [parentOf],
  );

  const activateFromList = useCallback(
    (id: string, action?: ActionType) => {
      const node = nodes.get(id);
      if (!node) return;
      // A plain Enter/Activate arrives with no action, and `onActivate`
      // without one clicks — wrong for a slider, which can only step. Resolve
      // the primary here, as `App.tsx`'s `handleActivate` does for DOM rows.
      const resolved = action ?? getPrimaryAction(nativeActions(node));
      if (resolved === "increment" || resolved === "decrement") {
        onActivate(node, resolved);
      } else {
        onActivate(node, isSelectableRole(node.role) ? "select" : undefined);
      }
    },
    [nodes, onActivate],
  );

  const activeDescendantId = (() => {
    if (selectedId === null) return undefined;
    const i = visibleIds.indexOf(selectedId);
    return i >= startIndex && i < endIndex
      ? `native-row-${selectedId}`
      : undefined;
  })();

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Mirrors the DOM producer's own `/`-focuses-search shortcut
      // (`useTreeKeyboard`'s `onFocusSearch`) — checked first and
      // unconditionally on `visibleIds`/`selectedId`, so it works even
      // against an empty or not-yet-loaded tree.
      if (e.key === "/" && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      if (visibleIds.length === 0) return;

      if (!selectedId) {
        if (e.key === "ArrowDown" || e.key === "Home") {
          e.preventDefault();
          setSelectedId(visibleIds[0]!);
        }
        return;
      }

      const currentIndex = visibleIds.indexOf(selectedId);
      if (currentIndex === -1) return;
      const node = nodes.get(selectedId);
      if (!node) return;

      switch (e.key) {
        case "ArrowDown": {
          e.preventDefault();
          const next = currentIndex + 1;
          if (next < visibleIds.length) setSelectedId(visibleIds[next]!);
          break;
        }
        case "ArrowUp": {
          e.preventDefault();
          const prev = currentIndex - 1;
          if (prev >= 0) setSelectedId(visibleIds[prev]!);
          break;
        }
        case "ArrowRight": {
          e.preventDefault();
          if ((node.childIds?.length ?? 0) === 0) break;
          if (!expanded.has(node.id)) {
            toggle(node.id);
          } else {
            const firstVisibleChild = node.childIds!.find((id) =>
              visibleIds.includes(id),
            );
            if (firstVisibleChild) setSelectedId(firstVisibleChild);
          }
          break;
        }
        case "ArrowLeft": {
          e.preventDefault();
          if (expanded.has(node.id) && (node.childIds?.length ?? 0) > 0) {
            toggle(node.id);
          } else {
            const parentId = parentOf.get(node.id);
            if (parentId) setSelectedId(parentId);
          }
          break;
        }
        case "Enter": {
          e.preventDefault();
          // Navigation/expand stay responsive while busy (no dispatch, no
          // conflict with an in-flight NATIVE_ACT) — only the activation
          // itself is held back, same as the action buttons' own `disabled`.
          if (primaryLabel(node)) {
            if (!busy) {
              onActivate(
                node,
                isSelectableRole(node.role) ? "select" : undefined,
              );
            }
          } else if ((node.childIds?.length ?? 0) > 0) {
            toggle(node.id);
          }
          break;
        }
        case " ": {
          e.preventDefault();
          if ((node.childIds?.length ?? 0) > 0) toggle(node.id);
          break;
        }
        case "+":
        case "=": {
          if (isSteppableRole(node.role)) {
            e.preventDefault();
            if (!busy) onActivate(node, "increment");
          }
          break;
        }
        case "-":
        case "_": {
          if (isSteppableRole(node.role)) {
            e.preventDefault();
            if (!busy) onActivate(node, "decrement");
          }
          break;
        }
        case "Home": {
          e.preventDefault();
          setSelectedId(visibleIds[0]!);
          break;
        }
        case "End": {
          e.preventDefault();
          setSelectedId(visibleIds[visibleIds.length - 1]!);
          break;
        }
      }
    },
    [
      visibleIds,
      selectedId,
      nodes,
      expanded,
      parentOf,
      toggle,
      onActivate,
      busy,
    ],
  );

  return (
    <>
      <div class="sn-toolbar" role="toolbar" aria-label="Native tree controls">
        <input
          ref={searchInputRef}
          class="sn-search"
          type="search"
          placeholder="Search nodes..."
          aria-label="Search native tree nodes"
          value={query}
          onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
        />
        {/* Mounted before there is a count to report — see App.tsx's
            identical DOM-producer span for why: a live region that arrives
            already holding text is not announced by most screen
            reader/browser pairs. */}
        <span class="sn-search-count" aria-live="polite">
          {hasFilter &&
            `${search.directIds.size} match${search.directIds.size !== 1 ? "es" : ""}`}
        </span>
        <button
          class="sn-toolbar-btn"
          onClick={onRefresh}
          disabled={busy}
          aria-label="Refresh native tree"
          title="Refresh native tree"
        >
          {busy ? "…" : "↻"}
        </button>
        <button
          class="sn-toolbar-btn"
          onClick={expandAll}
          disabled={nodes.size === 0}
          aria-label="Expand all"
          title="Expand all"
        >
          +
        </button>
        <button
          class="sn-toolbar-btn"
          onClick={collapseAll}
          disabled={nodes.size === 0}
          aria-label="Collapse all"
          title="Collapse all"
        >
          -
        </button>
        <span class="sn-page-url" aria-live="polite">
          {status}
        </span>
      </div>

      <div class="sn-filters" role="toolbar" aria-label="Filter by role">
        {ROLE_FILTER_KEYS.map((key) => (
          <button
            key={key}
            class="sn-filter-btn"
            aria-pressed={roleFilter === key}
            disabled={nodes.size === 0}
            onClick={() => setRoleFilter(roleFilter === key ? null : key)}
          >
            {ROLE_FILTER_LABELS[key]}
          </button>
        ))}
      </div>

      {capability && !capability.native && (
        <div role="status" class="sn-native-capability-banner">
          <strong>native unavailable here</strong> —{" "}
          {explainUnavailable(capability.reason!)}
        </div>
      )}

      {roleFilter !== null ? (
        <FilteredListView
          items={listItems}
          roleFilter={roleFilter}
          query={query}
          onActivate={activateFromList}
          onGoToTree={goToTree}
          onFocusSearch={() => searchInputRef.current?.focus()}
          activateDisabled={busy}
        />
      ) : (
        <>
          <div ref={containerRef} class="sn-tree-container" onScroll={onScroll}>
            <div
              ref={treeRef}
              class="sn-tree"
              role="tree"
              aria-label="Native accessibility tree — press Enter to activate, +/- to step, arrows to navigate"
              tabIndex={0}
              style={{
                minHeight: totalHeight,
                paddingTop: offset,
                boxSizing: "border-box",
              }}
              aria-activedescendant={activeDescendantId}
              onKeyDown={handleKeyDown}
            >
              {visibleIds.slice(startIndex, endIndex).map((id) => {
                const node = nodes.get(id);
                if (!node) return null;

                const hasChildren = (node.childIds?.length ?? 0) > 0;
                const isSelected = id === selectedId;
                const label = primaryLabel(node);
                const steppable = isSteppableRole(node.role);
                const selectAction = isSelectableRole(node.role)
                  ? "select"
                  : undefined;
                const position = visiblePositions.get(id);

                return (
                  <div
                    key={id}
                    id={`native-row-${id}`}
                    class={[
                      "sn-node",
                      isSelected && "sn-node--selected",
                      label && "sn-node--interactive",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    role="treeitem"
                    aria-expanded={hasChildren ? expanded.has(id) : undefined}
                    aria-selected={isSelected}
                    aria-level={node.depth + 1}
                    aria-posinset={position?.posinset}
                    aria-setsize={position?.setsize}
                    data-node-id={id}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedId(id);
                      // A mouse click on the row never moves real DOM focus (the
                      // row itself is tabIndex=-1; only the `.sn-tree` container
                      // is focusable, per the roving-focus/aria-activedescendant
                      // pattern above) — so without this, `.sn-tree:focus-visible
                      // .sn-node--selected`'s outline never has a `:focus-visible`
                      // container to key off, and the selected row shows no focus
                      // ring at all. Mirrors App.tsx's DOM-tree `handleSelect`,
                      // which calls the identical `treeRef.current?.focus()`.
                      treeRef.current?.focus();
                    }}
                    onDblClick={(e) => {
                      e.stopPropagation();
                      if (label) {
                        if (!busy) onActivate(node, selectAction);
                      } else if (hasChildren) {
                        toggle(id);
                      }
                    }}
                  >
                    <span class="sn-indent">
                      {Array.from({ length: node.depth }, (_, i) => (
                        <span key={i} class="sn-indent-unit" />
                      ))}
                    </span>

                    <button
                      class={`sn-toggle ${!hasChildren ? "sn-toggle--leaf" : ""}`}
                      tabIndex={-1}
                      aria-hidden="true"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (hasChildren) toggle(id);
                      }}
                    >
                      {hasChildren ? (expanded.has(id) ? "▾" : "▸") : ""}
                    </button>

                    <span class="sn-label">
                      <span class="sn-role">{node.role}</span>
                      {node.name && (
                        <span class="sn-name" title={node.name}>
                          {node.name}
                        </span>
                      )}
                      {node.description && (
                        <span class="sn-description" title={node.description}>
                          {node.description.length > 80
                            ? node.description.slice(0, 80) + "…"
                            : node.description}
                        </span>
                      )}
                      {node.value !== undefined && (
                        <span class="sn-field-value">
                          {"= "}
                          {JSON.stringify(node.value)}
                        </span>
                      )}
                      {node.value === undefined && node.placeholder && (
                        <span class="sn-field-value" title="Placeholder hint">
                          {"placeholder: "}
                          {JSON.stringify(node.placeholder)}
                        </span>
                      )}
                      {(() => {
                        const badges: string[] = [];
                        for (const [key, value] of Object.entries(
                          node.states ?? {},
                        )) {
                          if (key === "expanded") {
                            badges.push(
                              value === true ? "expanded" : "collapsed",
                            );
                          } else if (key === "checked" && value === "mixed") {
                            badges.push("mixed");
                          } else if (value === true) {
                            badges.push(key);
                          } else if (value !== false) {
                            badges.push(`${key}=${value}`);
                          }
                        }
                        // AX properties (heading level, hasPopup, orientation,
                        // value bounds, …) — a separate collection from states on
                        // the wire (native-core.ts's axFacets), and DogfoodPanel's
                        // own formatFacets shows both. Always key=value; unlike
                        // states, nothing here is a bare boolean flag.
                        for (const [key, value] of Object.entries(
                          node.properties ?? {},
                        )) {
                          badges.push(`${key}=${value}`);
                        }
                        if (badges.length === 0) return null;
                        return (
                          <span class="sn-state-badges">
                            {badges.map((b) => (
                              <span
                                key={b}
                                class="sn-state-badge sn-state--info"
                              >
                                {b}
                              </span>
                            ))}
                          </span>
                        );
                      })()}
                      {label && <span class="sn-action-tag">{label}</span>}
                    </span>

                    {label && (
                      <button
                        class="sn-action sn-action--visible"
                        tabIndex={-1}
                        disabled={busy}
                        onClick={(e) => {
                          e.stopPropagation();
                          onActivate(node, selectAction);
                        }}
                        title={`${label} (Enter)`}
                      >
                        {"⏎"}
                      </button>
                    )}

                    {steppable && (
                      <span class="sn-action-pair">
                        <button
                          class="sn-action sn-action--visible sn-action--step"
                          tabIndex={-1}
                          disabled={busy}
                          aria-label={`Decrement "${node.name || node.role}"`}
                          title="Decrement"
                          onClick={(e) => {
                            e.stopPropagation();
                            onActivate(node, "decrement");
                          }}
                        >
                          {"▼"}
                        </button>
                        <button
                          class="sn-action sn-action--visible sn-action--step"
                          tabIndex={-1}
                          disabled={busy}
                          aria-label={`Increment "${node.name || node.role}"`}
                          title="Increment"
                          onClick={(e) => {
                            e.stopPropagation();
                            onActivate(node, "increment");
                          }}
                        >
                          {"▲"}
                        </button>
                      </span>
                    )}
                  </div>
                );
              })}

              {visibleIds.length === 0 && (
                <div class="sn-empty">
                  {capability && !capability.native
                    ? "Native unavailable on this page"
                    : nodes.size === 0
                      ? "No native tree loaded yet — hit refresh"
                      : hasFilter
                        ? `No matches${query ? ` for "${query}"` : ""}`
                        : "Empty tree"}
                </div>
              )}
            </div>
          </div>

          <div class="sn-hints">
            <kbd>Enter</kbd> activate &middot; <kbd>+/-</kbd> step &middot;{" "}
            <kbd>Space</kbd> expand &middot; <kbd>Arrow</kbd> navigate
          </div>
        </>
      )}
    </>
  );
}
