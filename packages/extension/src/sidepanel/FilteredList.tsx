import type {
  SemanticNode,
  DomSemanticNode,
  RoleFilter,
} from "@real-a11y-dev/core";
import { ROLE_FILTER_GROUPS, getPrimaryAction } from "@real-a11y-dev/core";
import {
  createTypeAheadBuffer,
  findTypeAheadIndex,
  isTypeAheadKey,
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

interface FilteredListProps {
  nodes: Map<string, SemanticNode>;
  roleFilter: Exclude<RoleFilter, null>;
  query: string;
  onHighlight: (nodeId: string) => void;
  onActivate: (nodeId: string) => void;
  onGoToTree: (nodeId: string) => void;
  /** Focus the panel search input when `/` is pressed. */
  onFocusSearch?: () => void;
}

export function FilteredList({
  nodes,
  roleFilter,
  query,
  onHighlight,
  onActivate,
  onGoToTree,
  onFocusSearch,
}: FilteredListProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const typeAhead = useRef(createTypeAheadBuffer());

  const isHeading = roleFilter === "heading";

  // Get direct matches in document order
  const matches = useMemo(() => {
    const roles = ROLE_FILTER_GROUPS[roleFilter];
    if (!roles) return [];

    // The panel only renders DOM-produced trees, so every node has all facets.
    const result: DomSemanticNode[] = [];
    const lowerQuery = query.toLowerCase();

    for (const node of nodes.values() as IterableIterator<DomSemanticNode>) {
      if (!roles.includes(node.a11y.role)) continue;
      // Apply text search within results
      if (lowerQuery) {
        const name = (node.a11y.name || "").toLowerCase();
        const text = (node.dom.textContent || "").toLowerCase();
        if (!name.includes(lowerQuery) && !text.includes(lowerQuery)) continue;
      }
      result.push(node);
    }

    return result;
  }, [nodes, roleFilter, query]);

  // Reset selection and type-ahead when the filter criteria change (not when nodes refresh)
  useEffect(() => {
    setSelectedIndex(0);
    typeAhead.current.clear();
  }, [roleFilter, query]);

  const selectedNode = matches[selectedIndex] ?? null;

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
        if (matches[index]) onHighlight(matches[index].id);
      };

      switch (e.key) {
        case "ArrowDown": {
          e.preventDefault();
          typeAhead.current.clear();
          selectAt(Math.min(selectedIndex + 1, matches.length - 1));
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
          selectAt(matches.length - 1);
          break;
        }
        case "Enter": {
          e.preventDefault();
          typeAhead.current.clear();
          if (selectedNode) {
            if (INTERACTIVE_FILTERS.has(roleFilter)) {
              const action = getPrimaryAction(selectedNode.interaction.actions);
              if (action) {
                onActivate(selectedNode.id);
              } else {
                onHighlight(selectedNode.id);
              }
            } else {
              onGoToTree(selectedNode.id);
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
          if (!isTypeAheadKey(e) || matches.length === 0) break;
          e.preventDefault();
          const buffer = typeAhead.current.push(e.key);
          const labels = matches.map(
            (n) =>
              n.a11y.name || n.dom.textContent?.trim() || n.a11y.role || "",
          );
          const next = findTypeAheadIndex(labels, buffer, selectedIndex);
          if (next >= 0) selectAt(next);
          break;
        }
      }
    },
    [
      matches,
      selectedIndex,
      selectedNode,
      roleFilter,
      onHighlight,
      onActivate,
      onGoToTree,
      onFocusSearch,
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
          selectedIndex >= 0 && selectedIndex < matches.length
            ? `sn-filtered-opt-${selectedIndex}`
            : undefined
        }
        onKeyDown={handleKeyDown}
      >
        {matches.map((node, index) => {
          const level = node.a11y.properties.level;
          const indent = isHeading && level ? (parseInt(level) - 1) * 16 : 0;
          const isSelected = index === selectedIndex;

          // Collect state descriptions
          const states: string[] = [];
          for (const [key, val] of Object.entries(node.a11y.states)) {
            if (val === true) states.push(key);
            else if (typeof val === "string" && val !== "false") {
              states.push(`${key}: ${val}`);
            }
          }

          // For non-heading items, show available action
          const primaryAction = getPrimaryAction(node.interaction.actions);

          return (
            <div
              key={node.id}
              id={`sn-filtered-opt-${index}`}
              class={`sn-filtered-item ${isSelected ? "sn-filtered-item--selected" : ""}`}
              role="option"
              aria-selected={isSelected}
              data-index={index}
              style={indent ? `padding-left: ${indent + 8}px` : undefined}
              onClick={() => {
                setSelectedIndex(index);
                onHighlight(node.id);
              }}
              onDblClick={() => {
                if (INTERACTIVE_FILTERS.has(roleFilter) && primaryAction) {
                  onActivate(node.id);
                } else {
                  onGoToTree(node.id);
                }
              }}
            >
              {isHeading && level && (
                <span class="sn-level-badge">H{level}</span>
              )}
              <span class="sn-filtered-name">
                {node.a11y.name ||
                  node.dom.textContent ||
                  `(${node.dom.tagName})`}
              </span>
              {states.length > 0 && (
                <span class="sn-filtered-states">{states.join(", ")}</span>
              )}
            </div>
          );
        })}
        {matches.length === 0 && (
          <div class="sn-empty">
            No {roleFilter}s found{query ? ` matching "${query}"` : ""}
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div class="sn-list-actions">
        <span class="sn-list-count">{matches.length} items</span>
        <button
          class="sn-list-action-btn"
          disabled={
            !selectedNode || !getPrimaryAction(selectedNode.interaction.actions)
          }
          onClick={() => selectedNode && onActivate(selectedNode.id)}
        >
          Activate
        </button>
        <button
          class="sn-list-action-btn"
          disabled={!selectedNode}
          onClick={() => selectedNode && onHighlight(selectedNode.id)}
        >
          Move to
        </button>
      </div>
    </div>
  );
}
