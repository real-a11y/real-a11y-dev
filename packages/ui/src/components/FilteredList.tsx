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
const INTERACTIVE_FILTERS = new Set(["link", "button", "form"]);

interface FilteredListProps {
  nodes: Map<string, SemanticNode>;
  roleFilter: Exclude<RoleFilter, null>;
  query: string;
  onSelect: (nodeId: string) => void;
  onActivate: (nodeId: string) => void;
}

export function FilteredList({
  nodes,
  roleFilter,
  query,
  onSelect,
  onActivate,
}: FilteredListProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const isHeading = roleFilter === "heading";

  // Direct matches only — no ancestor walking
  const matches = useMemo(() => {
    const roles = ROLE_FILTER_GROUPS[roleFilter];
    if (!roles) return [];

    const result: SemanticNode[] = [];
    const lowerQuery = query.toLowerCase();

    for (const node of nodes.values()) {
      if (!roles.includes(node.a11y.role)) continue;
      if (lowerQuery) {
        const name = (node.a11y.name || "").toLowerCase();
        const text = (node.dom.textContent || "").toLowerCase();
        if (!name.includes(lowerQuery) && !text.includes(lowerQuery)) continue;
      }
      result.push(node);
    }

    return result;
  }, [nodes, roleFilter, query]);

  // Reset selection when filter criteria change
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

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown": {
          e.preventDefault();
          const next = Math.min(selectedIndex + 1, matches.length - 1);
          setSelectedIndex(next);
          if (matches[next]) onSelect(matches[next].id);
          break;
        }
        case "ArrowUp": {
          e.preventDefault();
          const prev = Math.max(selectedIndex - 1, 0);
          setSelectedIndex(prev);
          if (matches[prev]) onSelect(matches[prev].id);
          break;
        }
        case "Home": {
          e.preventDefault();
          setSelectedIndex(0);
          if (matches[0]) onSelect(matches[0].id);
          break;
        }
        case "End": {
          e.preventDefault();
          const last = matches.length - 1;
          setSelectedIndex(last);
          if (matches[last]) onSelect(matches[last].id);
          break;
        }
        case "Enter": {
          e.preventDefault();
          if (selectedNode) {
            if (INTERACTIVE_FILTERS.has(roleFilter)) {
              const action = getPrimaryAction(selectedNode.interaction.actions);
              if (action) onActivate(selectedNode.id);
              else onSelect(selectedNode.id);
            } else {
              onSelect(selectedNode.id);
            }
          }
          break;
        }
      }
    },
    [matches, selectedIndex, selectedNode, roleFilter, onSelect, onActivate],
  );

  return (
    <div class="sn-filtered-list-container">
      <div
        ref={listRef}
        class="sn-filtered-list"
        role="listbox"
        aria-label={`${roleFilter} elements`}
        tabIndex={0}
        onKeyDown={handleKeyDown}
      >
        {matches.map((node, index) => {
          const level = node.a11y.properties.level;
          const indent = isHeading && level ? (parseInt(level) - 1) * 16 : 0;
          const isSelected = index === selectedIndex;

          const states: string[] = [];
          for (const [key, val] of Object.entries(node.a11y.states)) {
            if (val === true) states.push(key);
            else if (typeof val === "string" && val !== "false") {
              states.push(`${key}: ${val}`);
            }
          }

          const primaryAction = getPrimaryAction(node.interaction.actions);

          return (
            <div
              key={node.id}
              class={`sn-filtered-item${isSelected ? " sn-filtered-item--selected" : ""}`}
              role="option"
              aria-selected={isSelected}
              data-index={index}
              style={indent ? `padding-left: ${indent + 8}px` : undefined}
              onClick={() => {
                setSelectedIndex(index);
                onSelect(node.id);
              }}
              onDblClick={() => {
                if (INTERACTIVE_FILTERS.has(roleFilter) && primaryAction) {
                  onActivate(node.id);
                } else {
                  onSelect(node.id);
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
          onClick={() => selectedNode && onSelect(selectedNode.id)}
        >
          Move to
        </button>
      </div>
    </div>
  );
}
