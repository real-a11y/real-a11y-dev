import type { ActionType, RoleFilter } from "@real-a11y-dev/core";
import { ROLE_FILTER_GROUPS, getPrimaryAction } from "@real-a11y-dev/core";
import {
  createTypeAheadBuffer,
  findTypeAheadIndex,
  isTypeAheadKey,
  resolveStepperKeyAction,
} from "@real-a11y-dev/semantic-navigator-ui";
import type { MutableRef } from "preact/hooks";
import { useState, useRef, useCallback, useEffect } from "preact/hooks";

import { handleListScopeKey } from "./scope.js";

// Filters whose items have meaningful activate actions
const INTERACTIVE_FILTERS: Set<string> = new Set(["link", "button", "form"]);

/**
 * One row of the role-filtered list. `NativeTreeView` maps its nodes onto
 * this shape, and `FilteredListView` renders it.
 */
export interface FilteredListItem {
  id: string;
  /** Row text, also what type-ahead matches against. */
  label: string;
  /** Heading level. Drives the `H<n>` badge and indent under the Headings filter. */
  level?: number;
  /** State descriptions shown after the label (`describeStates`). */
  states: string[];
  /** What the row can do, in `interaction.actions`' vocabulary. Decides whether
   *  Enter/Activate does anything and which stepper keys apply. */
  actions: ActionType[];
}

/** Format a node's states the way the list shows them: a `true` flag by its
 *  key, any other non-`"false"` string as `key: value`. */
export function describeStates(
  states: Record<string, string | boolean> | undefined,
): string[] {
  const out: string[] = [];
  for (const [key, val] of Object.entries(states ?? {})) {
    if (val === true) out.push(key);
    else if (typeof val === "string" && val !== "false") {
      out.push(`${key}: ${val}`);
    }
  }
  return out;
}

interface FilteredListViewProps {
  /** Matches in document order. */
  items: FilteredListItem[];
  roleFilter: Exclude<RoleFilter, null>;
  query: string;
  /** Highlight the row's element on the page. Omit when the producer can't
   *  (a native tree view with no page follow wired in): selection still
   *  moves, and the "Move to" button is hidden rather than left doing
   *  nothing. */
  onHighlight?: (nodeId: string) => void;
  /** Optional action lets stepper keys dispatch increment/decrement. */
  onActivate: (nodeId: string, action?: ActionType) => void;
  onGoToTree: (nodeId: string) => void;
  /** Focus the panel search input when `/` is pressed. */
  onFocusSearch?: () => void;
  /** Hold activation back while a previous one is still in flight. */
  activateDisabled?: boolean;
  /** The scope root's id when the items come from a scoped subtree, or
   *  null. A change re-finds the selected item by id, since a wider or
   *  narrower scope shifts every index after the first item it adds or drops;
   *  while set, the empty state says "in this scope". */
  scopeRootId?: string | null;
  /** Leave the scope: Escape in the list does what it does in the tree. */
  onExitScope?: () => void;
  /** A pick is armed and Escape belongs to cancelling it. */
  pickArmed?: boolean;
  /** Receives the listbox element, for a caller that hands it focus. */
  listRef?: MutableRef<HTMLElement | null>;
  /** "Show full names" (Settings): a long name shows whole, and the list
   *  scrolls sideways, as the tree does (`lists.css`). */
  showFullNames?: boolean;
}

export function FilteredListView({
  items,
  roleFilter,
  query,
  onHighlight,
  onActivate,
  onGoToTree,
  onFocusSearch,
  activateDisabled = false,
  scopeRootId = null,
  onExitScope,
  pickArmed = false,
  listRef: outerListRef,
  showFullNames = false,
}: FilteredListViewProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);
  const setListRef = useCallback(
    (el: HTMLDivElement | null) => {
      listRef.current = el;
      if (outerListRef) outerListRef.current = el;
    },
    [outerListRef],
  );
  const scoped = scopeRootId !== null;
  const typeAhead = useRef(createTypeAheadBuffer());

  const isHeading = roleFilter === "heading";

  // Reset selection and type-ahead when the filter criteria change (not when nodes refresh)
  useEffect(() => {
    setSelectedIndex(0);
    typeAhead.current.clear();
  }, [roleFilter, query]);

  // Follow the selected item, not its index, across a scope change: leaving
  // a scope can add matches ahead of it, and Enter would then act on a row
  // the user never selected. Falls back to the first item when the selected
  // one is outside the new scope. `selectedIdRef` still holds the previous
  // commit's selection here, because it is updated by the effect below.
  const selectedIdRef = useRef<string | null>(null);
  const prevScopeRootId = useRef(scopeRootId);
  useEffect(() => {
    if (prevScopeRootId.current === scopeRootId) return;
    prevScopeRootId.current = scopeRootId;
    const id = selectedIdRef.current;
    const at = id === null ? -1 : items.findIndex((item) => item.id === id);
    setSelectedIndex(Math.max(at, 0));
    typeAhead.current.clear();
  }, [scopeRootId, items]);
  useEffect(() => {
    selectedIdRef.current = items[selectedIndex]?.id ?? null;
  });

  const selectedItem = items[selectedIndex] ?? null;

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current || selectedIndex < 0) return;
    const el = listRef.current.querySelector(`[data-index="${selectedIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const selectAt = (index: number) => {
        setSelectedIndex(index);
        if (items[index]) onHighlight?.(items[index].id);
      };

      if (handleListScopeKey(e, { scoped, pickArmed, onExitScope })) {
        typeAhead.current.clear();
        return;
      }

      switch (e.key) {
        case "ArrowDown": {
          e.preventDefault();
          typeAhead.current.clear();
          selectAt(Math.min(selectedIndex + 1, items.length - 1));
          break;
        }
        case "ArrowUp": {
          e.preventDefault();
          typeAhead.current.clear();
          selectAt(Math.max(selectedIndex - 1, 0));
          break;
        }
        case "Home": {
          e.preventDefault();
          typeAhead.current.clear();
          selectAt(0);
          break;
        }
        case "End": {
          e.preventDefault();
          typeAhead.current.clear();
          selectAt(items.length - 1);
          break;
        }
        case "Enter": {
          e.preventDefault();
          typeAhead.current.clear();
          if (selectedItem) {
            if (INTERACTIVE_FILTERS.has(roleFilter)) {
              const step = resolveStepperKeyAction(e, selectedItem.actions);
              const action = step ?? getPrimaryAction(selectedItem.actions);
              if (action) {
                if (!activateDisabled) {
                  onActivate(selectedItem.id, step ?? undefined);
                }
              } else if (onHighlight) {
                onHighlight(selectedItem.id);
              } else {
                // Nothing to activate and no page highlight (a `listbox`
                // under a producer with no page follow): open its tree row
                // instead, the same place a double-click already goes, so
                // Enter is never a dead key.
                onGoToTree(selectedItem.id);
              }
            } else {
              onGoToTree(selectedItem.id);
            }
          }
          break;
        }
        case "/": {
          if (!onFocusSearch || e.ctrlKey || e.altKey || e.metaKey) break;
          e.preventDefault();
          typeAhead.current.clear();
          onFocusSearch();
          break;
        }
        default: {
          if (selectedItem && INTERACTIVE_FILTERS.has(roleFilter)) {
            const step = resolveStepperKeyAction(e, selectedItem.actions);
            if (step) {
              e.preventDefault();
              typeAhead.current.clear();
              if (!activateDisabled) onActivate(selectedItem.id, step);
              break;
            }
          }
          if (!isTypeAheadKey(e) || items.length === 0) break;
          e.preventDefault();
          const buffer = typeAhead.current.push(e.key);
          const labels = items.map((item) => item.label);
          const next = findTypeAheadIndex(labels, buffer, selectedIndex);
          if (next >= 0) selectAt(next);
          break;
        }
      }
    },
    [
      items,
      selectedIndex,
      selectedItem,
      roleFilter,
      onHighlight,
      onActivate,
      onGoToTree,
      onFocusSearch,
      activateDisabled,
      scoped,
      pickArmed,
      onExitScope,
    ],
  );

  return (
    <div class="sn-filtered-list-container">
      <div
        ref={setListRef}
        class={`sn-filtered-list${showFullNames ? " sn-filtered-list--full-names" : ""}`}
        role="listbox"
        aria-label={`${ROLE_FILTER_GROUPS[roleFilter] ? roleFilter : ""} elements`}
        tabIndex={0}
        // Container-focus composite: announce the active option to screen
        // readers, which otherwise hear nothing as aria-selected flips on rows
        // that never hold DOM focus. Bounds-check selectedIndex, not just
        // non-emptiness: it's reset only on filter/query change, so when the
        // page mutates and the result set shrinks it can point past the end,
        // leaving aria-activedescendant dangling at a row that isn't rendered.
        aria-activedescendant={
          selectedIndex >= 0 && selectedIndex < items.length
            ? `sn-filtered-opt-${selectedIndex}`
            : undefined
        }
        onKeyDown={handleKeyDown}
      >
        {items.map((item, index) => {
          const level = item.level;
          const indent = isHeading && level ? (level - 1) * 16 : 0;
          const isSelected = index === selectedIndex;

          // For non-heading items, show available action
          const primaryAction = getPrimaryAction(item.actions);

          return (
            <div
              key={item.id}
              id={`sn-filtered-opt-${index}`}
              class={`sn-filtered-item ${isSelected ? "sn-filtered-item--selected" : ""}`}
              role="option"
              aria-selected={isSelected}
              data-index={index}
              style={indent ? `padding-left: ${indent + 8}px` : undefined}
              onClick={() => {
                setSelectedIndex(index);
                onHighlight?.(item.id);
              }}
              onDblClick={() => {
                if (INTERACTIVE_FILTERS.has(roleFilter) && primaryAction) {
                  if (!activateDisabled) onActivate(item.id);
                } else {
                  onGoToTree(item.id);
                }
              }}
            >
              {isHeading && level && (
                <span class="sn-level-badge">H{level}</span>
              )}
              {/* With its whole text as a tooltip, for when it ends in an
                  ellipsis. */}
              <span class="sn-filtered-name" title={item.label}>
                {item.label}
              </span>
              {item.states.length > 0 && (
                <span class="sn-filtered-states">{item.states.join(", ")}</span>
              )}
            </div>
          );
        })}
        {items.length === 0 && (
          <div class="sn-empty">
            No {roleFilter}s found{query ? ` matching "${query}"` : ""}
            {scoped ? " in this scope" : ""}
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div class="sn-list-actions">
        <span class="sn-list-count">{items.length} items</span>
        <button
          class="sn-list-action-btn"
          disabled={
            !selectedItem ||
            !getPrimaryAction(selectedItem.actions) ||
            activateDisabled
          }
          onClick={() => selectedItem && onActivate(selectedItem.id)}
        >
          Activate
        </button>
        {onHighlight && (
          <button
            class="sn-list-action-btn"
            disabled={!selectedItem}
            onClick={() => selectedItem && onHighlight(selectedItem.id)}
          >
            Move to
          </button>
        )}
      </div>
    </div>
  );
}
