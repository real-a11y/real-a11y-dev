import type { SemanticNode } from "@real-a11y-dev/core";
import { useCallback } from "preact/hooks";

interface UseTreeKeyboardOptions {
  nodes: Map<string, SemanticNode>;
  visibleNodeIds: string[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onActivate: (id: string) => void;
}

/**
 * Keyboard navigation following WAI-ARIA TreeView pattern.
 * https://www.w3.org/WAI/ARIA/apg/patterns/treeview/
 */
export function useTreeKeyboard({
  nodes,
  visibleNodeIds,
  selectedId,
  onSelect,
  onToggle,
  onActivate,
}: UseTreeKeyboardOptions) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!selectedId || visibleNodeIds.length === 0) {
        // Select first node if nothing selected
        if (
          visibleNodeIds.length > 0 &&
          (e.key === "ArrowDown" || e.key === "Home")
        ) {
          e.preventDefault();
          onSelect(visibleNodeIds[0]);
        }
        return;
      }

      const currentIndex = visibleNodeIds.indexOf(selectedId);
      if (currentIndex === -1) return;

      const node = nodes.get(selectedId);
      if (!node) return;

      switch (e.key) {
        case "ArrowDown": {
          e.preventDefault();
          const nextIndex = currentIndex + 1;
          if (nextIndex < visibleNodeIds.length) {
            onSelect(visibleNodeIds[nextIndex]);
          }
          break;
        }

        case "ArrowUp": {
          e.preventDefault();
          const prevIndex = currentIndex - 1;
          if (prevIndex >= 0) {
            onSelect(visibleNodeIds[prevIndex]);
          }
          break;
        }

        case "ArrowRight": {
          e.preventDefault();
          if (node.childIds.length > 0) {
            if (!node.ui?.expanded) {
              onToggle(selectedId);
            } else {
              // Move to first child
              const firstVisibleChild = node.childIds.find((id) =>
                visibleNodeIds.includes(id),
              );
              if (firstVisibleChild) {
                onSelect(firstVisibleChild);
              }
            }
          }
          break;
        }

        case "ArrowLeft": {
          e.preventDefault();
          if (node.ui?.expanded && node.childIds.length > 0) {
            onToggle(selectedId);
          } else if (node.parentId) {
            onSelect(node.parentId);
          }
          break;
        }

        case "Enter": {
          e.preventDefault();
          onActivate(selectedId);
          break;
        }

        case " ": {
          e.preventDefault();
          if (node.childIds.length > 0) {
            onToggle(selectedId);
          }
          break;
        }

        case "Home": {
          e.preventDefault();
          if (visibleNodeIds.length > 0) {
            onSelect(visibleNodeIds[0]);
          }
          break;
        }

        case "End": {
          e.preventDefault();
          if (visibleNodeIds.length > 0) {
            onSelect(visibleNodeIds[visibleNodeIds.length - 1]);
          }
          break;
        }

        case "*": {
          // Expand all siblings
          e.preventDefault();
          if (node.parentId) {
            const parent = nodes.get(node.parentId);
            if (parent) {
              for (const siblingId of parent.childIds) {
                const sibling = nodes.get(siblingId);
                if (
                  sibling &&
                  sibling.childIds.length > 0 &&
                  !sibling.ui?.expanded
                ) {
                  onToggle(siblingId);
                }
              }
            }
          }
          break;
        }
      }
    },
    [nodes, visibleNodeIds, selectedId, onSelect, onToggle, onActivate],
  );

  return { handleKeyDown };
}
