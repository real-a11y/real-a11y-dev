import type { SemanticNode, RoleFilter } from "@real-a11y-dev/core";
import { ROLE_FILTER_GROUPS, getPrimaryAction } from "@real-a11y-dev/core";
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
}

export function FilteredList({
  nodes,
  roleFilter,
  query,
  onHighlight,
  onActivate,
  onGoToTree,
}: FilteredListProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const isHeading = roleFilter === "heading";

  // Get direct matches in document order
  const matches = useMemo(() => {
    const roles = ROLE_FILTER_GROUPS[roleFilter];
    if (!roles) return [];

    const result: SemanticNode[] = [];
    const lowerQuery = query.toLowerCase();

    for (const node of nodes.values()) {
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

  // Reset selection when the filter criteria change (not when nodes refresh)
  useEffect(() => {
    setSelectedIndex(0);
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
      switch (e.key) {
        case "ArrowDown": {
          e.preventDefault();
          const next = Math.min(selectedIndex + 1, matches.length - 1);
          setSelectedIndex(next);
          if (matches[next]) onHighlight(matches[next].id);
          break;
        }
        case "ArrowUp": {
          e.preventDefault();
          const prev = Math.max(selectedIndex - 1, 0);
          setSelectedIndex(prev);
          if (matches[prev]) onHighlight(matches[prev].id);
          break;
        }
        case "Home": {
          e.preventDefault();
          setSelectedIndex(0);
          if (matches[0]) onHighlight(matches[0].id);
          break;
        }
        case "End": {
          e.preventDefault();
          const last = matches.length - 1;
          setSelectedIndex(last);
          if (matches[last]) onHighlight(matches[last].id);
          break;
        }
        case "Enter": {
          e.preventDefault();
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
        // that never hold DOM focus.
        aria-activedescendant={
          matches.length > 0 ? `sn-filtered-opt-${selectedIndex}` : undefined
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
