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
 * Self-contained: owns its own expand/collapse set, selection, keyboard nav
 * and virtualization. `App.tsx` owns only the data (the last successful
 * `NATIVE_READ`), the capability banner inputs, and what an activation
 * DISPATCHES (`onActivate`) — the same division `TabSequenceView`/
 * `FilteredList` already use for the DOM producer's alternate views.
 */

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
  type NativeNode,
} from "../native/native-actions.js";

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

export function NativeTreeView({
  nodes,
  rootId,
  busy,
  capability,
  status,
  onRefresh,
  onActivate,
}: NativeTreeViewProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const treeRef = useRef<HTMLDivElement>(null);

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

  const parentOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const node of nodes.values()) {
      for (const childId of node.childIds ?? []) map.set(childId, node.id);
    }
    return map;
  }, [nodes]);

  const visibleIds = useMemo(() => {
    const ids: string[] = [];
    function walk(id: string) {
      const node = nodes.get(id);
      if (!node) return;
      ids.push(id);
      if (expanded.has(id)) {
        for (const childId of node.childIds ?? []) walk(childId);
      }
    }
    if (rootId) walk(rootId);
    return ids;
  }, [nodes, rootId, expanded]);

  const { startIndex, endIndex, totalHeight, offset, onScroll, scrollToIndex } =
    useVirtualTree(visibleIds.length);

  useEffect(() => {
    if (!selectedId) return;
    const index = visibleIds.indexOf(selectedId);
    if (index !== -1) scrollToIndex(index, "nearest");
  }, [selectedId, visibleIds, scrollToIndex]);

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

  const activeDescendantId = (() => {
    if (selectedId === null) return undefined;
    const i = visibleIds.indexOf(selectedId);
    return i >= startIndex && i < endIndex
      ? `native-row-${selectedId}`
      : undefined;
  })();

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
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
          if (primaryLabel(node)) {
            onActivate(
              node,
              isSelectableRole(node.role) ? "select" : undefined,
            );
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
            onActivate(node, "increment");
          }
          break;
        }
        case "-":
        case "_": {
          if (isSteppableRole(node.role)) {
            e.preventDefault();
            onActivate(node, "decrement");
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
    [visibleIds, selectedId, nodes, expanded, parentOf, toggle, onActivate],
  );

  return (
    <>
      <div class="sn-toolbar" role="toolbar" aria-label="Native tree controls">
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

      {capability && !capability.native && (
        <div
          role="status"
          style="margin:6px 8px;padding:4px 6px;border-left:3px solid #b45309;background:#fef3c7;color:#7c2d12;font-size:12px"
        >
          <strong>native unavailable here</strong> —{" "}
          {explainUnavailable(capability.reason!)}
        </div>
      )}

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
                data-node-id={id}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedId(id);
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
                  {node.name && <span class="sn-name">{node.name}</span>}
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
                        badges.push(value === true ? "expanded" : "collapsed");
                      } else if (key === "checked" && value === "mixed") {
                        badges.push("mixed");
                      } else if (value === true) {
                        badges.push(key);
                      } else if (value !== false) {
                        badges.push(`${key}=${value}`);
                      }
                    }
                    if (badges.length === 0) return null;
                    return (
                      <span class="sn-state-badges">
                        {badges.map((b) => (
                          <span key={b} class="sn-state-badge sn-state--info">
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
  );
}
