import type { SemanticNode, DomSemanticNode } from "@real-a11y-dev/core";
import { getTabSequence, getPrimaryAction } from "@real-a11y-dev/core";
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

function tabindexOf(node: DomSemanticNode): number | null {
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
  /** Focus the panel search input when `/` is pressed. */
  onFocusSearch?: () => void;
}

export function TabSequenceView({
  nodes,
  rootId,
  query,
  onHighlight,
  onActivate,
  onFocusSearch,
}: TabSequenceViewProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const typeAhead = useRef(createTypeAheadBuffer());

  const items = useMemo(() => {
    // The panel only renders DOM-produced trees, so every node has all facets.
    const seq = getTabSequence({ nodes, rootId }) as DomSemanticNode[];
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
    typeAhead.current.clear();
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
      const selectAt = (index: number) => {
        setSelectedIndex(index);
        if (items[index]) onHighlight(items[index].id);
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
            else onHighlight(selectedNode.id);
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
    [
      items,
      selectedIndex,
      selectedNode,
      onHighlight,
      onActivate,
      onFocusSearch,
    ],
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
        // and FilteredList). Bounds-check selectedIndex so a shrunk list can't
        // leave the reference dangling past the end.
        aria-activedescendant={
          selectedIndex >= 0 && selectedIndex < items.length
            ? `sn-tabseq-opt-${selectedIndex}`
            : undefined
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
