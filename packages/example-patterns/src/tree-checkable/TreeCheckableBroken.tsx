import { useState, type CSSProperties } from "react";

import type {
  TreeCheckableExampleProps,
  TreeCheckableNodeDef,
} from "./types.js";

// Hand-rolled "broken" Tree with checkboxes. Deliberately wrong on
// every interesting axis:
//
//   1. Container is a plain <ul> — NO role="tree" / role="treeitem",
//      NO aria-level / aria-posinset / aria-setsize, NO aria-expanded.
//      Reads as a generic nested list.
//
//   2. Each row's checkbox is a plain <input type="checkbox"> with
//      NO aria-checked="mixed" on parents. Parents whose children
//      are partially checked still read as "not checked", which
//      hides a UI state that's critical for AT users.
//
//   3. Checking a parent does NOT propagate to its children. Each
//      row's checked state is independent — so a parent can be
//      "checked" while its children are unchecked, which makes the
//      tri-state visualisation nonsense.
//
//   4. Every checkbox stays in the tab sequence — no roving
//      tabindex on the rows.
//
// Visually similar to the correct variant — same indentation,
// same chevrons, same checkboxes — but the propagation and ARIA
// layer are missing.
interface BrokenRowProps {
  node: TreeCheckableNodeDef;
  depth: number;
  expanded: Set<string>;
  toggleExpanded: (id: string) => void;
  checked: Set<string>;
  toggleChecked: (id: string) => void;
}

function BrokenRow({
  node,
  depth,
  expanded,
  toggleExpanded,
  checked,
  toggleChecked,
}: BrokenRowProps) {
  const hasChildren = !!node.children && node.children.length > 0;
  const isExpanded = expanded.has(node.id);
  const isChecked = checked.has(node.id);

  const rowStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "4px 8px",
    paddingLeft: 8 + depth * 16,
    font: "inherit",
  };

  return (
    <li style={{ listStyle: "none" }}>
      <div style={rowStyle}>
        {hasChildren ? (
          <button
            type="button"
            onClick={() => toggleExpanded(node.id)}
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
            {isExpanded ? "▾" : "▸"}
          </button>
        ) : (
          <span style={{ display: "inline-block", width: 16 }} />
        )}

        <input
          type="checkbox"
          checked={isChecked}
          onChange={() => toggleChecked(node.id)}
        />

        <span>{node.label}</span>
      </div>

      {hasChildren && isExpanded ? (
        <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
          {node.children!.map((child) => (
            <BrokenRow
              key={child.id}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              toggleExpanded={toggleExpanded}
              checked={checked}
              toggleChecked={toggleChecked}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function TreeCheckableBroken({
  label: _label,
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

  const toggleChecked = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <ul
      style={{
        margin: 0,
        padding: 4,
        listStyle: "none",
        border: "1px solid var(--vp-c-border, #ccc)",
        borderRadius: 6,
        minWidth: 260,
        background: "var(--vp-c-bg-elv, #fff)",
      }}
    >
      {nodes.map((node) => (
        <BrokenRow
          key={node.id}
          node={node}
          depth={0}
          expanded={expanded}
          toggleExpanded={toggleExpanded}
          checked={checked}
          toggleChecked={toggleChecked}
        />
      ))}
    </ul>
  );
}
