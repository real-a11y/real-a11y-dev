import { useState } from "react";

import type { TreeNodeDef, TreeViewExampleProps } from "./types.js";

// Hand-rolled "broken" tree view. Deliberately wrong on the
// hierarchy / role axis:
//
//   1. Container is a plain <ul> with NO role="tree" or "treegrid",
//      NO aria-label. Screen readers announce a generic list, not a
//      tree.
//
//   2. Items are plain <li>s with NO role="treeitem" or "row", NO
//      aria-level, NO aria-posinset / aria-setsize. Position in
//      hierarchy is visible (indentation, nested <ul>s) but invisible
//      to AT.
//
//   3. Parent rows have NO aria-expanded. The collapse/expand
//      affordance is a plain <button> with no announced state —
//      a screen reader hears "button" with no "expanded" / "collapsed"
//      suffix.
//
//   4. NO roving tabindex. Every interactive child (expand button,
//      leaf row) stays in the tab sequence.
//
// Visually identical to TreeViewCorrect — same indentation, same
// chevrons, same expanded/collapsed visuals — just no AT signal.
interface BrokenNodeProps {
  node: TreeNodeDef;
  depth: number;
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
}

function BrokenNode({ node, depth, expandedIds, onToggle }: BrokenNodeProps) {
  const hasChildren = !!node.children && node.children.length > 0;
  const isExpanded = expandedIds.has(node.id);

  return (
    <li style={{ listStyle: "none" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "4px 8px",
          paddingLeft: 8 + depth * 16,
          font: "inherit",
        }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => onToggle(node.id)}
            style={{
              width: 16,
              height: 16,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
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
        <span>{node.label}</span>
      </div>
      {hasChildren && isExpanded ? (
        <ul style={{ margin: 0, padding: 0 }}>
          {node.children!.map((child) => (
            <BrokenNode
              key={child.id}
              node={child}
              depth={depth + 1}
              expandedIds={expandedIds}
              onToggle={onToggle}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function TreeViewBroken({
  label: _label,
  nodes,
  defaultExpandedIds,
}: TreeViewExampleProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    () => new Set(defaultExpandedIds ?? []),
  );

  const toggle = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
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
        minWidth: 240,
        background: "var(--vp-c-bg-elv, #fff)",
      }}
    >
      {nodes.map((node) => (
        <BrokenNode
          key={node.id}
          node={node}
          depth={0}
          expandedIds={expandedIds}
          onToggle={toggle}
        />
      ))}
    </ul>
  );
}
