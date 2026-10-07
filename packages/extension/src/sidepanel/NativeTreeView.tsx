/**
 * The native producer's tree view (RFC PR H/#229, shipped in the store build
 * since #386). Renders Chromium's own accessibility tree,
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
  indexControlLinks,
  ROLE_FILTER_LABELS,
  type ActionType,
  type ControlLinkSource,
  type RoleFilter,
} from "@real-a11y-dev/core";
import {
  createTypeAheadBuffer,
  findTypeAheadIndex,
  isJumpKey,
  isTypeAheadKey,
  JUMP_KEYS,
  JUMP_KEYSHORTCUTS,
  nextJump,
  resolveStepperKeyAction,
  useInputModality,
  useVirtualTree,
  type JumpCycle,
} from "@real-a11y-dev/semantic-navigator-ui";
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
  nativeSelectOptions,
  isSteppableRole,
  isTypableRole,
  type NativeNode,
} from "../native/native-actions.js";
import { searchNativeTree } from "../native/native-search.js";
import { nativeParentIndex } from "../native/native-tree-utils.js";

import { ControlsChip, JUMP_FLASH_MS } from "./ControlsChip.js";
import { announcedValueLabel } from "./field-value.js";
import {
  describeStates,
  FilteredListView,
  type FilteredListItem,
} from "./FilteredList.js";
import { findNativeModalDialog } from "./native-feedback.js";
import {
  NATIVE_FOLLOW_DEBOUNCE_MS,
  NATIVE_HOVER_DWELL_MS,
} from "./native-follow.js";
import {
  arrowLeftStopsAtScopeRoot,
  describeNode,
  hasChildren,
  isInScope,
  matchCountLabel,
  SCOPE_KEY_HINT,
  scopeKeyAction,
  scopePath,
} from "./scope.js";
import { ScopeBar } from "./ScopeBar.js";
import { DialogIndicator, SendKeyBar, type SendKey } from "./SendKeyBar.js";
import { useDwellTimer } from "./use-dwell-timer.js";

const ROLE_FILTER_KEYS = Object.keys(ROLE_FILTER_LABELS) as Array<
  Exclude<RoleFilter, null>
>;

/** A native pick to reveal. `nonce` changes on every pick result, even a
 *  repeated pick of the same node, so the reveal runs again rather than
 *  bailing out on an unchanged `nodeId`. */
export interface NativeReveal {
  nodeId: string;
  /**
   * Nearest-first fallback chain — the picked node's own DOM ancestors — for
   * when `nodeId` itself was never kept in the AX tree (an unnamed wrapper,
   * padding inside a labelled group). Tried in order; the first one present
   * in `nodes` wins.
   */
  ancestorIds?: string[];
  nonce: number;
}

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
  /** A native pick just resolved: reveal and select that node. */
  reveal?: NativeReveal;
  /** The pick resolved to nothing in this tree: the page changed since the
   *  last read, or the element sits where the native read doesn't reach. */
  onRevealMiss?: () => void;
  /**
   * The user settled on this node as the selection (a click, arrow keys, a
   * pick, the role-filter list): App reveals it on the page, with the same
   * outline the DOM tree's selection draws. Optional, so a host that doesn't
   * care about the page can leave it out.
   */
  onSelectionReveal?: (nodeId: string) => void;
  /**
   * The pointer is resting on this row (after a short dwell), or `null` once
   * it has left one — App.tsx outlines the row's element on the page in
   * place, the DOM tree's hover preview. Optional for the same reason as
   * `onSelectionReveal`.
   */
  onHoverPreview?: (nodeId: string | null) => void;
  /**
   * The subtree the tree is scoped to, or null for the whole tree. Held by
   * App.tsx (Copy exports the same subtree) and changed through `onScope`:
   * double-click on a row with children that has no action of its own,
   * `Ctrl`/`Cmd`+`Enter` on any row with children, and the breadcrumb bar.
   * An id this tree doesn't have is treated as no scope.
   */
  scopedRootId?: string | null;
  onScope?: (id: string | null) => void;
  /** A pick is armed: Escape belongs to cancelling it, not to leaving scope. */
  pickArmed?: boolean;
  /**
   * Send a key to the page — the keyboard bar under the tree. Left out
   * without it.
   */
  onSendKey?: SendKey;
  /** The dialog indicator's **Press ESC**, for the open modal dialog with
   *  this id. The indicator is left out without it. */
  onDialogEscape?: (dialogId: string) => void;
  /** The "Follow page changes" setting: whether the tree reads itself again
   *  after every burst of page changes, not only after a navigation. The
   *  toggle is left out without `onToggleFollowPageChanges`. */
  followPageChanges?: boolean;
  onToggleFollowPageChanges?: () => void;
}

/** A node is worth a click/Enter action, a select action, or both never — the
 *  same three-way split `DogfoodPanel.tsx` renders from, reused here so a
 *  fix to one never silently diverges from the other. `selects` says the row
 *  selects: an option, or a real `<select>`, which opens the option picker
 *  as the DOM tree's does (see `nativeSelectIds`). */
function primaryLabel(node: NativeNode, selects: boolean): string | undefined {
  if (isTypableRole(node.role, node.states)) return "Type";
  if (selects) return "Select";
  if (ACTABLE.has(node.role)) return "Click";
  return undefined;
}

/** The ids of the rows backed by a real `<select>`, with option rows to pick
 *  from. Worked out once per tree read rather than per row and key press. */
function nativeSelectIds(nodes: Map<string, NativeNode>): Set<string> {
  const ids = new Set<string>();
  for (const node of nodes.values()) {
    if (nativeSelectOptions(node, nodes).length > 0) ids.add(node.id);
  }
  return ids;
}

/** What a native row can do, in `interaction.actions`' vocabulary, so the
 *  shared filtered list can decide Enter/Activate and the stepper keys the
 *  same way it does for a DOM row. Mirrors `primaryLabel`'s precedence. */
function nativeActions(node: NativeNode, selects: boolean): ActionType[] {
  const actions: ActionType[] = [];
  if (isTypableRole(node.role, node.states)) actions.push("type");
  else if (selects) actions.push("select");
  else if (ACTABLE.has(node.role)) actions.push("click");
  if (isSteppableRole(node.role)) actions.push("increment", "decrement");
  return actions;
}

function toListItem(node: NativeNode, selects: boolean): FilteredListItem {
  const level = parseInt(node.properties?.["level"] ?? "", 10);
  return {
    id: node.id,
    label: node.name || `(${node.role})`,
    level: Number.isNaN(level) ? undefined : level,
    states: describeStates(node.states),
    actions: nativeActions(node, selects),
  };
}

/** What type-ahead matches a row by — its name, else its role — the same
 *  fallback `useTreeKeyboard`'s `treeNodeTypeAheadLabel` uses for a DOM row
 *  (a native node has no text content of its own to fall between them). */
function typeAheadLabel(node: NativeNode): string {
  return node.name?.trim() || node.role;
}

/** Chromium's role for an `<iframe>`. The native read puts each frame's
 *  content under its row; one with nothing under it is a frame it couldn't
 *  read, so the row stands for content the tree doesn't show. */
function isIframeRole(role: string): boolean {
  return role === "Iframe" || role === "IframePresentational";
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
  onRevealMiss,
  onSelectionReveal,
  onHoverPreview,
  scopedRootId = null,
  onScope,
  pickArmed = false,
  onSendKey,
  onDialogEscape,
  followPageChanges = false,
  onToggleFollowPageChanges,
}: NativeTreeViewProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Bumped by an explicit gesture that re-selects a row — a click, or a pick
  // reveal — so the page-focus follow below re-fires even when `selectedId`
  // is already that row (focus may have moved elsewhere on the page since).
  const [followNonce, setFollowNonce] = useState(0);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  // The role filter's list, when it shows in the tree's place: where focus
  // goes after leaving the scope from the breadcrumb.
  const listRef = useRef<HTMLElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const typeAhead = useRef(createTypeAheadBuffer());

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
  const selectIds = useMemo(() => nativeSelectIds(nodes), [nodes]);
  /** The row selects: an option, or a real `<select>` (`primaryLabel`). */
  const selects = useCallback(
    (node: NativeNode) => isSelectableRole(node.role) || selectIds.has(node.id),
    [selectIds],
  );

  // A scope this view has just left, until App's prop catches up. Leaving
  // and selecting happen together (a pick outside the scope), and this view
  // can re-render with its new selection before App re-renders it with the
  // cleared scope. For that one render the selection
  // sits outside the still-scoped rows, and the selection effect below
  // drops it as gone. Applying the exit here as well keeps both changes in
  // the same render.
  const [leftScope, setLeftScope] = useState<string | null>(null);

  // The scope in effect: App's id, if this tree has it. The tree walks from
  // it and indents relative to it, the same as the DOM tree's
  // `effectiveRootId`/`scopedDepthOffset`.
  const scopeRoot =
    scopedRootId !== null &&
    scopedRootId !== leftScope &&
    nodes.has(scopedRootId)
      ? scopedRootId
      : null;
  const walkRoot = scopeRoot ?? rootId;
  const depthOffset = scopeRoot ? (nodes.get(scopeRoot)?.depth ?? 0) : 0;

  // Open the scope root whenever a scope becomes active, including on mount:
  // switching to DOM and back remounts this view with App's saved scope but
  // a freshly seeded expansion set (the page root and its children only), so
  // a deeper scope root would otherwise come back as one collapsed row.
  // Declared after the root-seeding layout effect above so its update lands
  // on top of the seeded set rather than being replaced by it. Keyed on the
  // scope alone, so a user collapsing the scope root later keeps it closed.
  useLayoutEffect(() => {
    if (!scopeRoot) return;
    setExpanded((prev) =>
      prev.has(scopeRoot) ? prev : new Set(prev).add(scopeRoot),
    );
  }, [scopeRoot]);

  // Scoping into a row also opens it, as DOM's `handleScopeToNode` does, so
  // the new root never arrives collapsed to a single line.
  const scopeTo = useCallback(
    (id: string | null) => {
      if (!onScope) return;
      if (id !== null) {
        setExpanded((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
      }
      setLeftScope(id === null ? scopedRootId : null);
      onScope(id);
    },
    [onScope, scopedRootId],
  );

  // Bring a row into view and select it: expand every ancestor (it may be
  // nested under rows the user never opened), leave a scope it sits outside
  // of, and clear any active search/role filter first, since a filter that
  // doesn't match the row would otherwise hide it and the selection effect
  // below would immediately drop it again (see that effect's own "gone from
  // the current tree" comment). Shared by a pick result and a jump chip.
  const revealRow = useCallback(
    (nodeId: string) => {
      // A row outside the scope is one the scoped tree never renders.
      if (
        scopeRoot &&
        !isInScope(nodeId, scopeRoot, (id) => parentOf.get(id))
      ) {
        scopeTo(null);
      }
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
      setFollowNonce((n) => n + 1);
      // Clearing the role filter above swaps `FilteredListView` back for the
      // actual tree — an async Preact re-render, not something the
      // `setRoleFilter(null)` call itself finishes — so `treeRef.current` is
      // still null (or stale) here when a filter was active a moment ago.
      // Same double-`requestAnimationFrame` defer `goToTree` above already
      // uses for the identical filtered-list-to-tree transition.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => treeRef.current?.focus());
      });
    },
    [scopeRoot, parentOf, scopeTo],
  );

  // A pick result lands here from App.tsx's own message handler.
  useEffect(() => {
    if (!reveal) return;
    // The exact hit-tested node may not itself be one the AX tree kept — an
    // unnamed wrapper `<span>`, padding inside a labelled group. Fall back
    // to the nearest ancestor that IS present, same as the DOM picker's own
    // `resolveTracked` walking `.parentElement` for the identical reason.
    const nodeId = [reveal.nodeId, ...(reveal.ancestorIds ?? [])].find((id) =>
      nodes.has(id),
    );
    if (nodeId === undefined) {
      onRevealMiss?.();
      return;
    }
    revealRow(nodeId);
    // Only re-run on a new pick (`nonce`), not on every `nodes`/`parentOf`
    // change a background refresh causes.
  }, [reveal?.nonce]);

  // `aria-controls`, both ways, through the same index as the DOM tree's:
  // a row lists the rows it controls (Chromium's own relation,
  // `node.controls`) and the rows that control it, plus a "likely" link the
  // `aria-haspopup` heuristic infers for a trigger with none. The heuristic
  // pairs by document order, so the walk is a pre-order one from the root.
  const controlsIndex = useMemo(() => {
    const links: ControlLinkSource[] = [];
    const stack = rootId ? [rootId] : [];
    while (stack.length > 0) {
      const node = nodes.get(stack.pop()!);
      if (!node) continue;
      links.push({
        id: node.id,
        role: node.role,
        controls: (node.controls ?? []).filter((t) => nodes.has(t)),
        haspopup: node.properties?.["hasPopup"],
        expanded: node.states?.["expanded"] === true,
        // A native tree holds only what Chromium exposes.
        hidden: false,
      });
      const children = node.childIds ?? [];
      for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]!);
    }
    return indexControlLinks(links);
  }, [nodes, rootId]);

  // The row a jump chip just landed on, flashed briefly as the DOM tree's
  // `handleJumpToNode` does.
  const [flashingId, setFlashingId] = useState<string | null>(null);
  // The run of Alt+J presses in progress, if any (see `nextJump`).
  const jumpCycle = useRef<JumpCycle | null>(null);
  const jumpTo = useCallback(
    (targetId: string) => {
      if (!nodes.has(targetId)) return;
      revealRow(targetId);
      setFlashingId(targetId);
      setTimeout(
        () => setFlashingId((cur) => (cur === targetId ? null : cur)),
        JUMP_FLASH_MS,
      );
    },
    [nodes, revealRow],
  );

  const hasFilter = query.trim().length > 0 || roleFilter !== null;

  const modalDialog = useMemo(() => findNativeModalDialog(nodes), [nodes]);

  // Same shape as `applySearchFilter`'s result for the DOM producer, minus
  // the mutation — see `native-search.ts` for why. Only actually walks
  // `nodes` when a filter is active (`searchNativeTree` short-circuits to an
  // empty result otherwise), so an untouched search box costs nothing here.
  const search = useMemo(
    () => searchNativeTree(nodes, parentOf, query, roleFilter),
    [nodes, parentOf, query, roleFilter],
  );

  // What the toolbar's count reports: every direct match, or only those
  // inside the scope while scoped — the same rows the scoped tree can show.
  const matchCount = useMemo(() => {
    if (!scopeRoot) return search.directIds.size;
    let n = 0;
    for (const id of search.directIds) {
      if (isInScope(id, scopeRoot, (p) => parentOf.get(p))) n++;
    }
    return n;
  }, [search, scopeRoot, parentOf]);

  // With a role filter on, show the same flat list the DOM producer does
  // (`FilteredList`) instead of the tree: every direct match, in document
  // order. A pre-order walk, not `nodes`' own iteration order, because that's
  // what "document order" means for this tree. It starts from the scope root
  // when scoped, so the list covers what the scoped tree covers and nothing
  // outside it. The query still narrows it, through the same `directIds` the
  // match count reports.
  const listItems = useMemo(() => {
    if (roleFilter === null) return [];
    const items: FilteredListItem[] = [];
    const stack = walkRoot ? [walkRoot] : [];
    while (stack.length > 0) {
      const id = stack.pop()!;
      const node = nodes.get(id);
      if (!node) continue;
      if (search.directIds.has(id)) items.push(toListItem(node, selects(node)));
      const children = node.childIds ?? [];
      for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]!);
    }
    return items;
  }, [nodes, walkRoot, roleFilter, search, selects]);

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
    if (walkRoot) walk(walkRoot, 1, 1);
    return { visibleIds: ids, visiblePositions: positions };
  }, [nodes, walkRoot, expanded, hasFilter, search]);

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
    if (visibleIds.indexOf(selectedId) === -1) {
      // The selected id is gone from the current tree (a refresh dropped it,
      // or its parent collapsed away). Leaving `selectedId` pointing at a
      // node no longer in `visibleIds` doesn't just skip a scroll — every
      // branch of handleKeyDown below bails out the same way on a -1 index,
      // so the WHOLE keyboard interface goes dead until the user clicks a
      // row with the mouse. Clearing it instead drops into handleKeyDown's
      // "no selection" branch, which re-selects the first visible row on the
      // next Arrow/Home press.
      setSelectedId(null);
    }
  }, [selectedId, visibleIds]);

  // Scroll the selection into view when it moves — and only then, as the DOM
  // tree does. Keyed on the selection and a reveal (`followNonce`), not on
  // `visibleIds`: a re-read, an automatic one included, rebuilds that list,
  // and a user who scrolled away from the selected row must not be snapped
  // back to it every time the page changes.
  const visibleIdsRef = useRef(visibleIds);
  visibleIdsRef.current = visibleIds;
  useEffect(() => {
    if (!selectedId) return;
    const index = visibleIdsRef.current.indexOf(selectedId);
    if (index !== -1) scrollToIndex(index, "nearest");
  }, [selectedId, followNonce, scrollToIndex]);

  // Follow the selection onto the page (`onSelectionReveal`). Debounced: a
  // key-repeat burst walks `selectedId` through several rows, and each
  // reveal is a full attach → reveal → detach round trip, so only the row the
  // user settles on is revealed. The callback is read through a ref, not
  // listed as a dependency: a host's callback may change identity when its
  // own state flips, and re-running then would reveal the same row again,
  // stealing focus back from whatever an activation just opened. One timer is shared with the role-filter list's follow
  // (`followFromList`), so the later request always replaces the pending one.
  const onSelectionRevealRef = useRef(onSelectionReveal);
  onSelectionRevealRef.current = onSelectionReveal;
  const {
    schedule: scheduleFollowTimer,
    cancel: cancelFollow,
    flush: flushFollow,
  } = useDwellTimer(NATIVE_FOLLOW_DEBOUNCE_MS);
  const scheduleFollow = useCallback(
    (id: string) =>
      scheduleFollowTimer(() => onSelectionRevealRef.current?.(id)),
    [scheduleFollowTimer],
  );
  // A click whose reveal this effect hasn't scheduled yet (it runs after
  // paint), and whether the pointer left the clicked row in that time: see
  // `endHover`. Every run of the effect settles both.
  const clickAwaitsFollow = useRef(false);
  const clickRevealOwesClear = useRef(false);
  useEffect(() => {
    clickAwaitsFollow.current = false;
    if (!selectedId) return;
    if (clickRevealOwesClear.current) {
      // The pointer has already left: reveal now, then clear what it draws,
      // as `endHover` does for a reveal still pending when it left.
      clickRevealOwesClear.current = false;
      onSelectionRevealRef.current?.(selectedId);
      onHoverPreviewRef.current?.(null);
      return;
    }
    scheduleFollow(selectedId);
    return cancelFollow;
  }, [selectedId, followNonce, scheduleFollow, cancelFollow]);

  // Hover preview. Each one is a debugger round trip like the follow above,
  // so it waits for the pointer to rest on a row rather than firing for every
  // row a sweep crosses. A row that scrolls under a still pointer during
  // keyboard navigation is not a new hover (`useInputModality`), the same
  // guard the DOM tree's rows use — but leaving a row always ends its hover,
  // whatever the modality, or keyboard scrolling would strand an outline
  // already shown. A row that goes away under a still pointer gets no
  // `mouseleave` at all — collapsed, dropped by a re-read, out of the
  // rendered slice, the tree swapped for a role filter's list, or this view
  // unmounted — so those end its hover too. Only an outline actually asked
  // for (`hoverShown`) is reported cleared; a preview still waiting is just
  // cancelled.
  const { isMouseModality, markKeyboard } = useInputModality();
  const onHoverPreviewRef = useRef(onHoverPreview);
  onHoverPreviewRef.current = onHoverPreview;
  const { schedule: scheduleHover, cancel: cancelHover } = useDwellTimer(
    NATIVE_HOVER_DWELL_MS,
  );
  const hoverRowId = useRef<string | null>(null);
  const hoverShown = useRef(false);
  // A click on the hovered row outlines it too (the selection's reveal), so
  // leaving the row clears that as it clears a preview, even before the
  // dwell showed one. A reveal still waiting is sent first, for the clear to
  // follow: `useNativeOverlay` clears a reveal that settles after a leave.
  const hoverClicked = useRef(false);
  const endHover = useCallback(() => {
    cancelHover();
    hoverRowId.current = null;
    if (hoverClicked.current) {
      hoverClicked.current = false;
      hoverShown.current = true;
      // Nothing pending: the reveal already went (the clear below follows
      // it), or the click's reveal isn't scheduled yet, since that happens
      // after paint and the pointer can leave before it. Only the second
      // owes a clear once it is sent.
      if (!flushFollow() && clickAwaitsFollow.current) {
        clickRevealOwesClear.current = true;
      }
    }
    if (!hoverShown.current) return;
    hoverShown.current = false;
    onHoverPreviewRef.current?.(null);
  }, [cancelHover, flushFollow]);
  const enterRow = (id: string) => {
    if (!isMouseModality()) return;
    endHover();
    hoverRowId.current = id;
    scheduleHover(() => {
      hoverShown.current = true;
      onHoverPreviewRef.current?.(id);
    });
  };
  const leaveRow = (id: string) => {
    if (hoverRowId.current === id) endHover();
  };
  useEffect(() => endHover, [endHover]);
  // The list a role filter shows replaces the tree's rows outright.
  useEffect(() => {
    if (roleFilter !== null) endHover();
  }, [roleFilter, endHover]);
  // The hovered row left the rendered rows without a `mouseleave`.
  useEffect(() => {
    const id = hoverRowId.current;
    if (id !== null && !visibleIds.slice(startIndex, endIndex).includes(id)) {
      endHover();
    }
  }, [visibleIds, startIndex, endIndex, endHover]);

  // The role-filter list's selection lives in `FilteredListView`, not in
  // `selectedId`, so it follows onto the page through this instead: every
  // click, arrow/Home/End/type-ahead move and "Move to" in the list calls
  // it, the same `onHighlight` hook the DOM producer's list drives its page
  // highlight with. Absent `onSelectionReveal` it stays undefined, which is
  // how the list knows to hide "Move to" rather than show a dead button.
  const followFromList = onSelectionReveal ? scheduleFollow : undefined;

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
      if (hasChildren(node)) all.add(node.id);
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
      // No scope check: the list is built from the scope root in the same
      // render as this callback, so every item it offers is inside the scope.
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

  /**
   * What plain Enter does to a row, in the tree and in its role-filter list
   * alike: the row's own action, and for a slider, which has none but a
   * step, a step up. A spinbutton's own action is its edit box — the only
   * keyboard way to type a value from the native tree — so Enter opens it,
   * and Shift+Enter or +/- step it. (The DOM tree's Enter steps a spinbutton
   * up instead: its primary action comes from core's `getPrimaryAction`,
   * shared by every surface.) Returns false when the row has nothing to do.
   */
  const activateRow = useCallback(
    (node: NativeNode): boolean => {
      if (primaryLabel(node, selects(node))) {
        onActivate(node, isSelectableRole(node.role) ? "select" : undefined);
        return true;
      }
      if (isSteppableRole(node.role)) {
        onActivate(node, "increment");
        return true;
      }
      return false;
    },
    [onActivate, selects],
  );

  const activateFromList = useCallback(
    (id: string, action?: ActionType) => {
      const node = nodes.get(id);
      if (!node) return;
      // A stepper key arrives with its step; a plain Enter or Activate with
      // none, and gets the tree's Enter.
      if (action === "increment" || action === "decrement") {
        onActivate(node, action);
      } else {
        activateRow(node);
      }
    },
    [nodes, onActivate, activateRow],
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
        typeAhead.current.clear();
        searchInputRef.current?.focus();
        return;
      }

      const scopeAction = scopeKeyAction(e, {
        scoped: scopeRoot !== null,
        pickArmed,
      });
      if (scopeAction === "exit") {
        e.preventDefault();
        scopeTo(null);
        return;
      }
      if (scopeAction === "scope") {
        // Consumed even with nothing to scope into, so it never falls through
        // to plain Enter and activates the row by surprise.
        e.preventDefault();
        const target = selectedId ? nodes.get(selectedId) : undefined;
        if (target && hasChildren(target)) scopeTo(target.id);
        return;
      }

      // The jump chips' keyboard path — the ui package's `nextJump`, which
      // every tree's keymap shares. A jump starts type-ahead afresh.
      if (isJumpKey(e)) {
        e.preventDefault();
        typeAhead.current.clear();
        if (selectedId === null) return;
        const next = nextJump(
          selectedId,
          jumpCycle.current,
          e.shiftKey,
          controlsIndex,
          (id) => nodes.has(id),
        );
        if (!next) return;
        jumpCycle.current = next.cycle;
        jumpTo(next.target);
        return;
      }

      if (visibleIds.length === 0) return;

      // Type-ahead, as the DOM tree's `useTreeKeyboard` has it: printable
      // keys move to the next row whose name (else role) starts with them.
      const tryTypeAhead = (from: number) => {
        if (!isTypeAheadKey(e)) return;
        e.preventDefault();
        const buffer = typeAhead.current.push(e.key);
        const labels = visibleIds.map((id) => {
          const n = nodes.get(id);
          return n ? typeAheadLabel(n) : "";
        });
        const next = findTypeAheadIndex(labels, buffer, from);
        if (next >= 0) setSelectedId(visibleIds[next]!);
      };

      if (!selectedId) {
        if (e.key === "ArrowDown" || e.key === "Home") {
          e.preventDefault();
          typeAhead.current.clear();
          setSelectedId(visibleIds[0]!);
          return;
        }
        tryTypeAhead(-1);
        return;
      }

      const currentIndex = visibleIds.indexOf(selectedId);
      if (currentIndex === -1) return;
      const node = nodes.get(selectedId);
      if (!node) return;

      // `+`/`-` and `Shift+Enter` step a slider or spinbutton before Enter or
      // type-ahead see the key: the mapping the DOM tree and the role-filter
      // lists share.
      const step = resolveStepperKeyAction(
        e,
        nativeActions(node, selects(node)),
      );
      if (step === "increment" || step === "decrement") {
        e.preventDefault();
        typeAhead.current.clear();
        if (!busy) onActivate(node, step);
        return;
      }

      switch (e.key) {
        case "ArrowDown": {
          e.preventDefault();
          typeAhead.current.clear();
          const next = currentIndex + 1;
          if (next < visibleIds.length) setSelectedId(visibleIds[next]!);
          break;
        }
        case "ArrowUp": {
          e.preventDefault();
          typeAhead.current.clear();
          const prev = currentIndex - 1;
          if (prev >= 0) setSelectedId(visibleIds[prev]!);
          break;
        }
        case "ArrowRight": {
          e.preventDefault();
          typeAhead.current.clear();
          if (!hasChildren(node)) break;
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
          typeAhead.current.clear();
          const isOpen = expanded.has(node.id) && hasChildren(node);
          if (isOpen) {
            toggle(node.id);
          } else if (!arrowLeftStopsAtScopeRoot(node.id, scopeRoot, isOpen)) {
            const parentId = parentOf.get(node.id);
            if (parentId) setSelectedId(parentId);
          }
          break;
        }
        case "Enter": {
          e.preventDefault();
          typeAhead.current.clear();
          // See `activateRow`. Navigation/expand stay responsive while busy
          // (no dispatch, no conflict with an in-flight NATIVE_ACT) — only
          // the activation itself is held back, same as the action buttons'
          // own `disabled`.
          if (primaryLabel(node, selects(node)) || isSteppableRole(node.role)) {
            if (!busy) activateRow(node);
          } else if (hasChildren(node)) {
            toggle(node.id);
          }
          break;
        }
        case " ": {
          e.preventDefault();
          typeAhead.current.clear();
          if (hasChildren(node)) toggle(node.id);
          break;
        }
        case "Home": {
          e.preventDefault();
          typeAhead.current.clear();
          setSelectedId(visibleIds[0]!);
          break;
        }
        case "End": {
          e.preventDefault();
          typeAhead.current.clear();
          setSelectedId(visibleIds[visibleIds.length - 1]!);
          break;
        }
        case "*": {
          // Expand every sibling that has children (WAI-ARIA TreeView), as
          // the DOM tree's `useTreeKeyboard` does: nothing on the tree's own
          // root, which has no siblings. On the scope root it opens just that
          // row, the one visible effect of DOM's `*` there — DOM also opens
          // the scope root's siblings, which the scoped tree doesn't render.
          e.preventDefault();
          typeAhead.current.clear();
          const parentId = parentOf.get(node.id);
          const siblings =
            node.id === scopeRoot
              ? [node.id]
              : parentId
                ? (nodes.get(parentId)?.childIds ?? [])
                : [];
          setExpanded((prev) => {
            const next = new Set(prev);
            for (const id of siblings) {
              if ((nodes.get(id)?.childIds?.length ?? 0) > 0) next.add(id);
            }
            return next;
          });
          break;
        }
        default:
          tryTypeAhead(currentIndex);
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
      activateRow,
      selects,
      busy,
      scopeRoot,
      pickArmed,
      scopeTo,
      controlsIndex,
      jumpTo,
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
          {hasFilter && matchCountLabel(matchCount, scopeRoot !== null)}
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
        {onToggleFollowPageChanges && (
          <button
            class="sn-toolbar-btn"
            onClick={onToggleFollowPageChanges}
            aria-pressed={followPageChanges}
            aria-label="Follow page changes"
            title="Follow page changes: read the tree again whenever the page changes, not only after it navigates. Each read shows Chrome's debugging bar."
          >
            ⟳
          </button>
        )}
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

      {onDialogEscape && (
        <DialogIndicator
          dialog={modalDialog ?? null}
          onEscape={() => modalDialog && onDialogEscape(modalDialog.id)}
        />
      )}

      {capability && !capability.native && (
        <div role="status" class="sn-native-capability-banner">
          <strong>native unavailable here</strong> —{" "}
          {explainUnavailable(capability.reason!)}
        </div>
      )}

      {scopeRoot && (
        <ScopeBar
          path={scopePath(
            scopeRoot,
            (id) => parentOf.get(id),
            (id) => {
              const n = nodes.get(id);
              return n ? describeNode(n.role, n.name) : undefined;
            },
          )}
          rootId={rootId}
          onScope={scopeTo}
          focusAfterExit={() => treeRef.current ?? listRef.current}
        />
      )}

      {roleFilter !== null ? (
        <FilteredListView
          items={listItems}
          roleFilter={roleFilter}
          query={query}
          onHighlight={followFromList}
          onActivate={activateFromList}
          onGoToTree={goToTree}
          onFocusSearch={() => searchInputRef.current?.focus()}
          activateDisabled={busy}
          scopeRootId={scopeRoot}
          onExitScope={() => scopeTo(null)}
          pickArmed={pickArmed}
          listRef={listRef}
        />
      ) : (
        <>
          <div
            ref={containerRef}
            class={`sn-tree-container${scopeRoot ? " sn-tree-container--scoped" : ""}`}
            onScroll={onScroll}
          >
            <div
              ref={treeRef}
              class="sn-tree"
              role="tree"
              aria-label={`Native accessibility tree — press Enter to activate (a slider steps up, a spinbutton opens its edit box), +/− or Shift+Enter to step sliders and spinbuttons, arrows to navigate, ${SCOPE_KEY_HINT}, Alt+J to follow a row's aria-controls links one by one and Alt+Shift+J to go back`}
              aria-keyshortcuts={JUMP_KEYSHORTCUTS}
              tabIndex={0}
              style={{
                minHeight: totalHeight,
                paddingTop: offset,
                boxSizing: "border-box",
              }}
              aria-activedescendant={activeDescendantId}
              onKeyDown={(e) => {
                // The keyboard takes over: a preview still waiting is
                // dropped, and a click's selection is the keyboard's now.
                // An outline already shown stays until its row is left.
                markKeyboard();
                hoverClicked.current = false;
                if (!hoverShown.current) endHover();
                handleKeyDown(e);
              }}
            >
              {visibleIds.slice(startIndex, endIndex).map((id) => {
                const node = nodes.get(id);
                if (!node) return null;

                const isParent = hasChildren(node);
                const isSelected = id === selectedId;
                const label = primaryLabel(node, selects(node));
                const steppable = isSteppableRole(node.role);
                const selectAction = selects(node) ? "select" : undefined;
                const position = visiblePositions.get(id);
                // A heading's level shows as the DOM tree's `H2` badge rather
                // than among the generic `key=value` properties below. Only
                // for headings: a tree item or grid row carries a level too.
                const headingLevel =
                  node.role === "heading"
                    ? node.properties?.["level"]
                    : undefined;

                return (
                  <div
                    key={id}
                    id={`native-row-${id}`}
                    class={[
                      "sn-node",
                      isSelected && "sn-node--selected",
                      label && "sn-node--interactive",
                      id === flashingId && "sn-node--flash",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    role="treeitem"
                    aria-expanded={isParent ? expanded.has(id) : undefined}
                    aria-selected={isSelected}
                    aria-level={node.depth - depthOffset + 1}
                    aria-posinset={position?.posinset}
                    aria-setsize={position?.setsize}
                    data-node-id={id}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedId(id);
                      setFollowNonce((n) => n + 1);
                      hoverClicked.current = hoverRowId.current === id;
                      clickAwaitsFollow.current = true;
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
                      // Same split as the DOM tree's row: a row with an
                      // action runs it, a container scopes the view to itself
                      // (expanding stays on the chevron and the arrow keys).
                      // One difference: DOM counts any focusable element as
                      // having an action (a `tabindex="0"` region focuses),
                      // native counts only what it can click, select or type
                      // into. A focusable container scopes here, because
                      // selecting its row already moved page focus onto it
                      // (`onSelectionReveal`), which is all DOM's activation
                      // of it would do.
                      if (label) {
                        if (!busy) onActivate(node, selectAction);
                      } else if (isParent) {
                        scopeTo(id);
                      }
                    }}
                    onMouseEnter={() => enterRow(id)}
                    onMouseLeave={() => leaveRow(id)}
                  >
                    <span class="sn-indent">
                      {Array.from(
                        { length: node.depth - depthOffset },
                        (_, i) => (
                          <span key={i} class="sn-indent-unit" />
                        ),
                      )}
                    </span>

                    <button
                      class={`sn-toggle ${!isParent ? "sn-toggle--leaf" : ""}`}
                      tabIndex={-1}
                      aria-hidden="true"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (isParent) toggle(id);
                      }}
                      // Its two clicks already toggled it; the row's own
                      // double-click must not act on the row as well (toggle
                      // it again, or activate an actionable row on the page).
                      onDblClick={(e) => e.stopPropagation()}
                    >
                      {isParent ? (expanded.has(id) ? "▾" : "▸") : ""}
                    </button>

                    <span class="sn-label">
                      <span class="sn-role">{node.role}</span>
                      {headingLevel && (
                        <span class="sn-level-badge">H{headingLevel}</span>
                      )}
                      {/* A frame the read found no content in: one it
                          couldn't reach, or an empty one. */}
                      {isIframeRole(node.role) && !hasChildren(node) && (
                        <span
                          class="sn-iframe-badge"
                          title="Embedded page — no content read from it"
                        >
                          embedded
                          <span class="sn-sr-only">
                            {" "}
                            page — nothing was read from it
                          </span>
                        </span>
                      )}
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
                      {/* What a screen reader announces (ADR-0001) — a
                          select's option label, not its raw `value`. */}
                      {node.value !== undefined && (
                        <span class="sn-field-value">
                          {announcedValueLabel(node.value)}
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
                          if (key === "level" && headingLevel) continue;
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
                      {/* Jump chips: to the rows this one controls, and back
                          to the rows that control it. */}
                      {controlsIndex.forward.get(id)?.map((targetId) => {
                        const target = nodes.get(targetId);
                        if (!target) return null;
                        return (
                          <ControlsChip
                            key={`controls-${targetId}`}
                            role={target.role}
                            name={target.name}
                            direction="forward"
                            inferred={controlsIndex.inferred.has(id)}
                            keyHint={JUMP_KEYS.forward}
                            onJump={() => jumpTo(targetId)}
                          />
                        );
                      })}
                      {controlsIndex.reverse.get(id)?.map((triggerId, i) => {
                        const trigger = nodes.get(triggerId);
                        if (!trigger) return null;
                        return (
                          <ControlsChip
                            key={`controlled-by-${triggerId}`}
                            role={trigger.role}
                            name={trigger.name}
                            direction="reverse"
                            inferred={controlsIndex.inferred.has(triggerId)}
                            // Alt+Shift+J reaches the first one.
                            keyHint={i === 0 ? JUMP_KEYS.back : undefined}
                            onJump={() => jumpTo(triggerId)}
                          />
                        );
                      })}
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

          {onSendKey && <SendKeyBar onSendKey={onSendKey} />}

          <div class="sn-hints">
            <kbd>Enter</kbd> activate &middot; <kbd>+/−</kbd> step &middot;{" "}
            <kbd>Space</kbd> expand &middot; <kbd>Arrow</kbd> navigate &middot;{" "}
            <kbd>DblClick</kbd> scope &middot; <kbd>Alt+(Shift)+J</kbd> jump
          </div>
        </>
      )}
    </>
  );
}
