import type { SemanticNode } from "@real-a11y-dev/core";
import { getTabSequence, getPrimaryAction } from "@real-a11y-dev/core";
import {
  useMemo,
  useState,
  useRef,
  useCallback,
  useEffect,
} from "preact/hooks";

function tabindexOf(node: SemanticNode): number | null {
  const raw = node.dom.attributes?.tabindex;
  if (raw === undefined) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

interface TabSequenceViewProps {
  nodes: Map<string, SemanticNode>;
  rootId: string;
  query: string;
  onHighlight: (nodeId: string) => void;
  onActivate: (nodeId: string) => void;
}

export function TabSequenceView({
  nodes,
  rootId,
  query,
  onHighlight,
  onActivate,
}: TabSequenceViewProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const items = useMemo(() => {
    const seq = getTabSequence({ nodes, rootId });
    if (!query.trim()) return seq;
    const lq = query.toLowerCase();
    return seq.filter((node) => {
      const name = (node.a11y.name || "").toLowerCase();
      const text = (node.dom.textContent || "").toLowerCase();
      const role = (node.a11y.role || "").toLowerCase();
      const tag = (node.dom.tagName || "").toLowerCase();
      return (
        name.includes(lq) ||
        text.includes(lq) ||
        role.includes(lq) ||
        tag.includes(lq)
      );
    });
  }, [nodes, rootId, query]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const selectedNode = items[selectedIndex] ?? null;

  useEffect(() => {
    if (!listRef.current || selectedIndex < 0) return;
    const el = listRef.current.querySelector(
      `[data-tab-index="${selectedIndex}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown": {
          e.preventDefault();
          const next = Math.min(selectedIndex + 1, items.length - 1);
          setSelectedIndex(next);
          if (items[next]) onHighlight(items[next].id);
          break;
        }
        case "ArrowUp": {
          e.preventDefault();
          const prev = Math.max(selectedIndex - 1, 0);
          setSelectedIndex(prev);
          if (items[prev]) onHighlight(items[prev].id);
          break;
        }
        case "Home": {
          e.preventDefault();
          setSelectedIndex(0);
          if (items[0]) onHighlight(items[0].id);
          break;
        }
        case "End": {
          e.preventDefault();
          const last = items.length - 1;
          setSelectedIndex(last);
          if (items[last]) onHighlight(items[last].id);
          break;
        }
        case "Enter": {
          e.preventDefault();
          if (selectedNode) {
            const action = getPrimaryAction(selectedNode.interaction.actions);
            if (action) onActivate(selectedNode.id);
            else onHighlight(selectedNode.id);
          }
          break;
        }
      }
    },
    [items, selectedIndex, selectedNode, onHighlight, onActivate],
  );

  return (
    <div class="sn-filtered-list-container">
      <div
        ref={listRef}
        class="sn-filtered-list"
        role="listbox"
        aria-label="Tab sequence"
        tabIndex={0}
        // Container-focus composite — announce the active option (see the tree
        // and FilteredList for the same pattern).
        aria-activedescendant={
          items.length > 0 ? `sn-tabseq-opt-${selectedIndex}` : undefined
        }
        onKeyDown={handleKeyDown}
      >
        {items.map((node, index) => {
          const isSelected = index === selectedIndex;
          const explicitTabindex = tabindexOf(node);
          const isPositiveTabindex =
            explicitTabindex !== null && explicitTabindex > 0;
          const label =
            node.a11y.name ||
            node.dom.textContent?.trim() ||
            `<${node.dom.tagName?.toLowerCase()}>`;

          return (
            <div
              key={node.id}
              id={`sn-tabseq-opt-${index}`}
              class={`sn-filtered-item sn-tab-item${isSelected ? " sn-filtered-item--selected" : ""}`}
              role="option"
              aria-selected={isSelected}
              data-tab-index={index}
              onClick={() => {
                setSelectedIndex(index);
                onHighlight(node.id);
              }}
              onDblClick={() => {
                const action = getPrimaryAction(node.interaction.actions);
                if (action) onActivate(node.id);
              }}
            >
              <span class="sn-tab-number">{index + 1}</span>
              <span class="sn-tab-role">{node.a11y.role}</span>
              <span class="sn-filtered-name sn-tab-name">
                {label.length > 60 ? label.slice(0, 57) + "…" : label}
              </span>
              {isPositiveTabindex && (
                <span
                  class="sn-tab-tabindex-badge"
                  title="Explicit positive tabindex — avoid if possible"
                >
                  tabindex={explicitTabindex}
                </span>
              )}
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
          onClick={() => selectedNode && onHighlight(selectedNode.id)}
        >
          Move to
        </button>
      </div>
    </div>
  );
}
