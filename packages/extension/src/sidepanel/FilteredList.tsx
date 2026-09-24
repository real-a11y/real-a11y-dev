import type {
  ActionType,
  SemanticNode,
  DomSemanticNode,
  RoleFilter,
} from "@real-a11y-dev/core";
import { ROLE_FILTER_GROUPS, getPrimaryAction } from "@real-a11y-dev/core";
import {
  createTypeAheadBuffer,
  findTypeAheadIndex,
  isTypeAheadKey,
  resolveStepperKeyAction,
} from "@real-a11y-dev/semantic-navigator-ui";
import {
  useMemo,
  useState,
  useRef,
  useCallback,
  useEffect,
} from "preact/hooks";

// Filters whose items have meaningful activate actions
const INTERACTIVE_FILTERS: Set<string> = new Set(["link", "button", "form"]);

/**
 * One row of the role-filtered list, in a shape either producer can fill.
 *
 * The list used to read `DomSemanticNode` facets directly, so the native
 * producer's tree view couldn't use it and kept filtering its tree in place
 * instead. The two modes then showed different UIs for the same filter.
 * Each producer now maps its own nodes onto this shape (`FilteredList` below
 * for DOM, `NativeTreeView` for native), and `FilteredListView` renders it.
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
   *  (native has no page highlight yet): selection still moves, and the
   *  "Move to" button is hidden rather than left doing nothing. */
  onHighlight?: (nodeId: string) => void;
  /** Optional action lets stepper keys dispatch increment/decrement. */
  onActivate: (nodeId: string, action?: ActionType) => void;
  onGoToTree: (nodeId: string) => void;
  /** Focus the panel search input when `/` is pressed. */
  onFocusSearch?: () => void;
  /** Hold activation back while a previous one is still in flight. */
  activateDisabled?: boolean;
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
}: FilteredListViewProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const typeAhead = useRef(createTypeAheadBuffer());

  const isHeading = roleFilter === "heading";

  // Reset selection and type-ahead when the filter criteria change (not when nodes refresh)
  useEffect(() => {
    setSelectedIndex(0);
    typeAhead.current.clear();
  }, [roleFilter, query]);

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
              } else {
                onHighlight?.(selectedItem.id);
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
    ],
  );

  return (
    <div class="sn-filtered-list-container">
      <div
        ref={listRef}
        class="sn-filtered-list"
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
              <span class="sn-filtered-name">{item.label}</span>
              {item.states.length > 0 && (
                <span class="sn-filtered-states">{item.states.join(", ")}</span>
              )}
            </div>
          );
        })}
        {items.length === 0 && (
          <div class="sn-empty">
            No {roleFilter}s found{query ? ` matching "${query}"` : ""}
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

interface FilteredListProps {
  nodes: Map<string, SemanticNode>;
  roleFilter: Exclude<RoleFilter, null>;
  query: string;
  onHighlight: (nodeId: string) => void;
  /** Optional action lets stepper keys dispatch increment/decrement. */
  onActivate: (nodeId: string, action?: ActionType) => void;
  onGoToTree: (nodeId: string) => void;
  /** Focus the panel search input when `/` is pressed. */
  onFocusSearch?: () => void;
}

/** The DOM producer's role-filtered list: maps `nodes` onto `FilteredListView`. */
export function FilteredList({
  nodes,
  roleFilter,
  query,
  ...rest
}: FilteredListProps) {
  // Get direct matches in document order
  const items = useMemo(() => {
    const roles = ROLE_FILTER_GROUPS[roleFilter];
    if (!roles) return [];

    // The DOM producer's tree always carries every facet.
    const result: FilteredListItem[] = [];
    const lowerQuery = query.toLowerCase();

    for (const node of nodes.values() as IterableIterator<DomSemanticNode>) {
      if (!roles.includes(node.a11y.role)) continue;
      // Apply text search within results
      if (lowerQuery) {
        const name = (node.a11y.name || "").toLowerCase();
        const text = (node.dom.textContent || "").toLowerCase();
        if (!name.includes(lowerQuery) && !text.includes(lowerQuery)) continue;
      }
      const level = parseInt(node.a11y.properties.level ?? "", 10);
      result.push({
        id: node.id,
        label:
          node.a11y.name ||
          node.dom.textContent?.trim() ||
          `(${node.dom.tagName})`,
        level: Number.isNaN(level) ? undefined : level,
        states: describeStates(node.a11y.states),
        actions: node.interaction.actions,
      });
    }

    return result;
  }, [nodes, roleFilter, query]);

  return (
    <FilteredListView
      items={items}
      roleFilter={roleFilter}
      query={query}
      {...rest}
    />
  );
}
