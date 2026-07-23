import type {
  SemanticNode,
  DomSemanticNode,
  RoleFilter,
} from "@real-a11y-dev/core";
import { ROLE_FILTER_GROUPS, getPrimaryAction } from "@real-a11y-dev/core";
import {
  useMemo,
  useState,
  useRef,
  useCallback,
  useEffect,
} from "preact/hooks";

import {
  createTypeAheadBuffer,
  findTypeAheadIndex,
  isTypeAheadKey,
} from "../hooks/typeAhead.js";
import { listOptionDomId, useInstanceId } from "../hooks/useInstanceId.js";

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
  const instanceId = useInstanceId("fl");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const typeAhead = useRef(createTypeAheadBuffer());

  // The panel only renders DOM-produced trees, so every node carries all
  // facets. Narrow once here so the list logic reads dom/interaction freely.
  const domNodes = nodes as Map<string, DomSemanticNode>;

  const isHeading = roleFilter === "heading";

  // Direct matches only — no ancestor walking
  const matches = useMemo(() => {
    const roles = ROLE_FILTER_GROUPS[roleFilter];
    if (!roles) return [];

    const result: DomSemanticNode[] = [];
    const lowerQuery = query.toLowerCase();

    for (const node of domNodes.values()) {
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
      const selectAt = (index: number) => {
        setSelectedIndex(index);
        if (matches[index]) onSelect(matches[index].id);
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
              if (action) onActivate(selectedNode.id);
              else onSelect(selectedNode.id);
            } else {
              onSelect(selectedNode.id);
            }
          }
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
        // Container-focus composite: focus stays here while arrow keys move an
        // aria-selected highlight across non-focusable rows, so the active row
        // must be announced via aria-activedescendant. Bounds-check
        // selectedIndex so a shrunk result set can't dangle past the end.
        aria-activedescendant={
          selectedIndex >= 0 && selectedIndex < matches.length
            ? listOptionDomId("filtered", instanceId, selectedIndex)
            : undefined
        }
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
              id={listOptionDomId("filtered", instanceId, index)}
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
