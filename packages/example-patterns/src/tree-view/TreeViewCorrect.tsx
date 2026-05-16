import { Button, Tree, TreeItem, TreeItemContent } from "react-aria-components";

import type { TreeNodeDef, TreeViewExampleProps } from "./types.js";

// Correct APG tree view, courtesy of react-aria-components.
//
// React Aria implements this as the WAI-ARIA Treegrid Pattern
// (role="treegrid" + role="row" + role="gridcell") rather than the
// simpler Tree pattern. Items still carry full hierarchy metadata,
// which is what makes the structure announceable:
//   - role="treegrid" on the container + aria-label from the prop
//   - role="row" on each item with computed aria-level,
//     aria-posinset, aria-setsize, aria-expanded (on parents),
//     aria-selected (when single-select is enabled)
//   - Keyboard nav: ↑/↓ move between visible rows, ←/→ collapse /
//     expand or move to parent/first child, Home/End for bounds,
//     typeahead, Enter activates
//   - Roving tabindex so only the active row is in the tab sequence
//
// Inspecting this surfaces the `treegrid > row*` structure with
// hierarchy levels visible in the panel.
function renderNode(node: TreeNodeDef) {
  const hasChildren = !!node.children && node.children.length > 0;
  return (
    <TreeItem
      key={node.id}
      id={node.id}
      textValue={node.label}
      style={({ isFocused }) => ({
        outline: "none",
        background: isFocused
          ? "var(--vp-c-default-soft, rgba(0,0,0,0.05))"
          : "transparent",
        borderRadius: 4,
      })}
    >
      <TreeItemContent>
        {({ isExpanded, hasChildItems }) => (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "4px 8px",
              font: "inherit",
            }}
          >
            {hasChildItems ? (
              <Button
                slot="chevron"
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
              </Button>
            ) : (
              <span style={{ display: "inline-block", width: 16 }} />
            )}
            <span>{node.label}</span>
          </div>
        )}
      </TreeItemContent>
      {hasChildren ? node.children!.map((child) => renderNode(child)) : null}
    </TreeItem>
  );
}

export function TreeViewCorrect({
  label,
  nodes,
  defaultExpandedIds,
}: TreeViewExampleProps) {
  return (
    <Tree
      aria-label={label}
      defaultExpandedKeys={defaultExpandedIds}
      style={{
        border: "1px solid var(--vp-c-border, #ccc)",
        borderRadius: 6,
        padding: 4,
        minWidth: 240,
        background: "var(--vp-c-bg-elv, #fff)",
        outline: "none",
      }}
    >
      {nodes.map((node) => renderNode(node))}
    </Tree>
  );
}
