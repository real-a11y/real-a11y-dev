import type { SemanticNode, DomSemanticNode } from "@real-a11y-dev/core";
import { getTabSequence, getPrimaryAction } from "@real-a11y-dev/core";
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

interface TabSequenceViewProps {
  nodes: Map<string, SemanticNode>;
  rootId: string;
  query: string;
  onSelect: (nodeId: string) => void;
  onActivate: (nodeId: string) => void;
  onHover: (nodeId: string | null) => void;
  /** Focus the panel search input when `/` is pressed. */
  onFocusSearch?: () => void;
}

function tabindexOf(node: DomSemanticNode): number | null {
  const raw = node.dom.attributes?.tabindex;
  if (raw === undefined) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function TabSequenceView({
  nodes,
  rootId,
  query,
  onSelect,
  onActivate,
  onHover,
  onFocusSearch,
}: TabSequenceViewProps) {
  const instanceId = useInstanceId("ts");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const typeAhead = useRef(createTypeAheadBuffer());

  // Full tab sequence, then optionally filtered by search query. The panel
  // only renders DOM-produced trees, so every sequenced node has all facets.
  const items = useMemo(() => {
    const seq = getTabSequence({ nodes, rootId }) as DomSemanticNode[];
    if (!query.trim()) return seq;
    const lq = query.toLowerCase();
    return seq.filter((node) => {
      const name = (node.a11y.name || "").toLowerCase();
      const text = (node.dom.textContent || "").toLowerCase();
      const tag = (node.dom.tagName || "").toLowerCase();
      const role = (node.a11y.role || "").toLowerCase();
      return (
        name.includes(lq) ||
        text.includes(lq) ||
        tag.includes(lq) ||
        role.includes(lq)
      );
    });
  }, [nodes, rootId, query]);

  // Reset selection and type-ahead when query changes
  useEffect(() => {
    setSelectedIndex(0);
    typeAhead.current.clear();
  }, [query]);

  const selectedNode = items[selectedIndex] ?? null;

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current || selectedIndex < 0) return;
    const el = listRef.current.querySelector(
      `[data-tab-index="${selectedIndex}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const selectAt = (index: number) => {
        setSelectedIndex(index);
        if (items[index]) onSelect(items[index].id);
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
          if (selectedNode) {
            const action = getPrimaryAction(selectedNode.interaction.actions);
            if (action) onActivate(selectedNode.id);
            else onSelect(selectedNode.id);
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
          if (!isTypeAheadKey(e) || items.length === 0) break;
          e.preventDefault();
          const buffer = typeAhead.current.push(e.key);
          const labels = items.map(
            (n) =>
              n.a11y.name || n.dom.textContent?.trim() || n.a11y.role || "",
          );
          const next = findTypeAheadIndex(labels, buffer, selectedIndex);
          if (next >= 0) selectAt(next);
          break;
        }
      }
    },
    [items, selectedIndex, selectedNode, onSelect, onActivate, onFocusSearch],
  );

  return (
    <div class="sn-filtered-list-container">
      <div
        ref={listRef}
        class="sn-tab-sequence-list sn-filtered-list"
        role="listbox"
        aria-label="Tab sequence"
        tabIndex={0}
        // Container-focus composite — announce the active option (see the
        // shared tree). Bounds-check so a shrunk list can't dangle past the end.
        aria-activedescendant={
          selectedIndex >= 0 && selectedIndex < items.length
            ? listOptionDomId("tabseq", instanceId, selectedIndex)
            : undefined
        }
        onKeyDown={handleKeyDown}
        onMouseLeave={() => onHover(null)}
      >
        {items.map((node, index) => {
          const isSelected = index === selectedIndex;
          const explicitTabindex = tabindexOf(node);
          // Positive tabindex is a common accessibility anti-pattern — flag it
          const isPositiveTabindex =
            explicitTabindex !== null && explicitTabindex > 0;
          const label =
            node.a11y.name ||
            node.dom.textContent?.trim() ||
            `<${node.dom.tagName?.toLowerCase()}>`;

          return (
            <div
              key={node.id}
              id={listOptionDomId("tabseq", instanceId, index)}
              class={`sn-filtered-item sn-tab-item${isSelected ? " sn-filtered-item--selected" : ""}`}
              role="option"
              aria-selected={isSelected}
              data-tab-index={index}
              onClick={() => {
                setSelectedIndex(index);
                onSelect(node.id);
              }}
              onDblClick={() => {
                const action = getPrimaryAction(node.interaction.actions);
                if (action) onActivate(node.id);
              }}
              onMouseEnter={() => onHover(node.id)}
            >
              {/* Position number */}
              <span class="sn-tab-number">{index + 1}</span>

              {/* Role */}
              <span class="sn-tab-role">{node.a11y.role}</span>

              {/* Accessible name / text content */}
              <span class="sn-filtered-name sn-tab-name">
                {label.length > 60 ? label.slice(0, 57) + "…" : label}
              </span>

              {/* Explicit positive tabindex warning badge */}
              {isPositiveTabindex && (
                <span
                  class="sn-tab-tabindex-badge"
                  title="Explicit positive tabindex — avoid if possible"
                >
                  tabindex={explicitTabindex}
                </span>
              )}

              {/* HTML tag */}
              <span class="sn-tab-tag">{`<${node.dom.tagName?.toLowerCase()}>`}</span>
            </div>
          );
        })}

        {items.length === 0 && (
          <div class="sn-empty">
            {query
              ? `No tab stops matching "${query}"`
              : "No focusable elements found"}
          </div>
        )}
      </div>

      {/* Bottom bar */}
      <div class="sn-list-actions">
        <span class="sn-list-count">
          {items.length} tab stop{items.length !== 1 ? "s" : ""}
        </span>
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
