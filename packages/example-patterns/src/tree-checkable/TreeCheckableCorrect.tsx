import { useState, type CSSProperties } from "react";

import type {
  TreeCheckableExampleProps,
  TreeCheckableNodeDef,
} from "./types.js";

// Correct APG Tree with checkboxes. Implements the simpler Tree
// pattern (role="tree" + role="treeitem") with aria-checked on each
// row carrying tri-state semantics:
//
//   - Leaf node aria-checked is "true" or "false"
//   - Parent node aria-checked is:
//     - "true" if every descendant leaf is checked
//     - "false" if no descendant leaf is checked
//     - "mixed" if some but not all are checked
//
// Toggling a leaf changes that leaf; parent state derives. Toggling
// a parent applies its new state to every descendant leaf (mixed +
// false both treat as "check all"; true treats as "uncheck all").
//
// Other accessibility wiring:
//   - aria-level / aria-posinset / aria-setsize on each row
//   - aria-expanded on parent rows
//   - Roving tabindex (the active treeitem is tabindex=0)
//   - ↑/↓ to move between visible rows, ←/→ for collapse/expand,
//     Space toggles the active row's checked state
function leafIds(node: TreeCheckableNodeDef): string[] {
  if (!node.children || node.children.length === 0) return [node.id];
  return node.children.flatMap(leafIds);
}

function checkedStateOf(
  node: TreeCheckableNodeDef,
  checked: ReadonlySet<string>,
): "true" | "false" | "mixed" {
  const leaves = leafIds(node);
  const checkedCount = leaves.filter((id) => checked.has(id)).length;
  if (checkedCount === 0) return "false";
  if (checkedCount === leaves.length) return "true";
  return "mixed";
}

interface FlatRow {
  node: TreeCheckableNodeDef;
  depth: number;
  posinset: number;
  setsize: number;
  isExpanded: boolean;
  hasChildren: boolean;
}

function flatten(
  nodes: TreeCheckableNodeDef[],
  expanded: ReadonlySet<string>,
  depth: number,
  out: FlatRow[],
): void {
  nodes.forEach((node, i) => {
    const hasChildren = !!node.children && node.children.length > 0;
    const isExpanded = hasChildren && expanded.has(node.id);
    out.push({
      node,
      depth,
      posinset: i + 1,
      setsize: nodes.length,
      isExpanded,
      hasChildren,
    });
    if (isExpanded) flatten(node.children!, expanded, depth + 1, out);
  });
}

export function TreeCheckableCorrect({
  label,
  nodes,
  defaultCheckedIds,
  defaultExpandedIds,
}: TreeCheckableExampleProps) {
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(defaultCheckedIds ?? []),
  );
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(defaultExpandedIds ?? []),
  );
  const [activeId, setActiveId] = useState<string>(nodes[0].id);

  const rows: FlatRow[] = [];
  flatten(nodes, expanded, 0, rows);

  function toggleChecked(node: TreeCheckableNodeDef) {
    const state = checkedStateOf(node, checked);
    const leaves = leafIds(node);
    setChecked((prev) => {
      const next = new Set(prev);
      // mixed or false → check all leaves; true → uncheck all leaves
      const turnOn = state !== "true";
      leaves.forEach((id) => {
        if (turnOn) next.add(id);
        else next.delete(id);
      });
      return next;
    });
  }

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLUListElement>) {
    const idx = rows.findIndex((r) => r.node.id === activeId);
    if (idx < 0) return;
    const row = rows[idx];
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (idx < rows.length - 1) setActiveId(rows[idx + 1].node.id);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (idx > 0) setActiveId(rows[idx - 1].node.id);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      if (row.hasChildren) {
        if (!row.isExpanded) toggleExpanded(row.node.id);
        else if (row.node.children && row.node.children.length > 0)
          setActiveId(row.node.children[0].id);
      }
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      if (row.hasChildren && row.isExpanded) toggleExpanded(row.node.id);
    } else if (e.key === "Home") {
      e.preventDefault();
      setActiveId(rows[0].node.id);
    } else if (e.key === "End") {
      e.preventDefault();
      setActiveId(rows[rows.length - 1].node.id);
    } else if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      toggleChecked(row.node);
    }
  }

  const rowStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "4px 8px",
    font: "inherit",
  };

  return (
    <ul
      role="tree"
      aria-label={label}
      tabIndex={0}
      onKeyDown={onKeyDown}
      style={{
        margin: 0,
        padding: 4,
        listStyle: "none",
        border: "1px solid var(--vp-c-border, #ccc)",
        borderRadius: 6,
        minWidth: 260,
        background: "var(--vp-c-bg-elv, #fff)",
        outline: "none",
      }}
    >
      {rows.map((row) => {
        const state = checkedStateOf(row.node, checked);
        const isActive = row.node.id === activeId;
        return (
          <li
            key={row.node.id}
            role="treeitem"
            aria-level={row.depth + 1}
            aria-posinset={row.posinset}
            aria-setsize={row.setsize}
            aria-checked={state}
            aria-selected={isActive}
            {...(row.hasChildren ? { "aria-expanded": row.isExpanded } : {})}
            tabIndex={isActive ? 0 : -1}
            onClick={() => setActiveId(row.node.id)}
            style={{
              listStyle: "none",
              outline: "none",
              background: isActive
                ? "var(--vp-c-default-soft, rgba(0,0,0,0.05))"
                : "transparent",
              borderRadius: 4,
            }}
          >
            <div
              style={{
                ...rowStyle,
                paddingLeft: 8 + row.depth * 16,
              }}
            >
              {row.hasChildren ? (
                <button
                  type="button"
                  aria-hidden="true"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleExpanded(row.node.id);
                  }}
                  style={{
                    width: 16,
                    height: 16,
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                    font: "inherit",
                    padding: 0,
                  }}
                >
                  {row.isExpanded ? "▾" : "▸"}
                </button>
              ) : (
                <span
                  aria-hidden="true"
                  style={{ display: "inline-block", width: 16 }}
                />
              )}

              {/* Visual checkbox glyph — purely decorative. The
                  aria-checked on the row is what AT reads. */}
              <span
                aria-hidden="true"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleChecked(row.node);
                }}
                style={{
                  display: "inline-block",
                  width: 14,
                  height: 14,
                  borderRadius: 3,
                  border: "1px solid var(--vp-c-border, #999)",
                  background:
                    state === "true"
                      ? "var(--vp-c-brand, #2e79ff)"
                      : "transparent",
                  color: "#fff",
                  textAlign: "center",
                  fontSize: 10,
                  lineHeight: "12px",
                  cursor: "pointer",
                }}
              >
                {state === "true" ? "✓" : state === "mixed" ? "–" : ""}
              </span>

              <span>{row.node.label}</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
