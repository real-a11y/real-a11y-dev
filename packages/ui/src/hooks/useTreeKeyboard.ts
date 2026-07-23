import type { SemanticNode } from "@real-a11y-dev/core";
import { useCallback, useRef } from "preact/hooks";

import {
  createTypeAheadBuffer,
  findTypeAheadIndex,
  isTypeAheadKey,
} from "./typeAhead.js";

interface UseTreeKeyboardOptions {
  nodes: Map<string, SemanticNode>;
  visibleNodeIds: string[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onActivate: (id: string) => void;
  /** Focus the panel search input when `/` is pressed (panel-features keymap). */
  onFocusSearch?: () => void;
}

/** Label used for type-ahead — accessible name, else text, else role. */
export function treeNodeTypeAheadLabel(node: SemanticNode): string {
  const name = node.a11y.name?.trim();
  if (name) return name;
  const text = node.dom?.textContent?.trim();
  if (text) return text;
  return node.a11y.role || "";
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
  onFocusSearch,
}: UseTreeKeyboardOptions) {
  const typeAhead = useRef(createTypeAheadBuffer());

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (
        e.key === "/" &&
        onFocusSearch &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.metaKey
      ) {
        e.preventDefault();
        typeAhead.current.clear();
        onFocusSearch();
        return;
      }

      if (visibleNodeIds.length === 0) return;

      const tryTypeAhead = (currentIndex: number) => {
        if (!isTypeAheadKey(e)) return false;
        e.preventDefault();
        const buffer = typeAhead.current.push(e.key);
        const labels = visibleNodeIds.map((id) => {
          const n = nodes.get(id);
          return n ? treeNodeTypeAheadLabel(n) : "";
        });
        const next = findTypeAheadIndex(labels, buffer, currentIndex);
        if (next >= 0) onSelect(visibleNodeIds[next]);
        return true;
      };

      if (!selectedId) {
        if (e.key === "ArrowDown" || e.key === "Home") {
          e.preventDefault();
          typeAhead.current.clear();
          onSelect(visibleNodeIds[0]);
          return;
        }
        tryTypeAhead(-1);
        return;
      }

      const currentIndex = visibleNodeIds.indexOf(selectedId);
      if (currentIndex === -1) return;

      const node = nodes.get(selectedId);
      if (!node) return;

      switch (e.key) {
        case "ArrowDown": {
          e.preventDefault();
          typeAhead.current.clear();
          const nextIndex = currentIndex + 1;
          if (nextIndex < visibleNodeIds.length) {
            onSelect(visibleNodeIds[nextIndex]);
          }
          break;
        }

        case "ArrowUp": {
          e.preventDefault();
          typeAhead.current.clear();
          const prevIndex = currentIndex - 1;
          if (prevIndex >= 0) {
            onSelect(visibleNodeIds[prevIndex]);
          }
          break;
        }

        case "ArrowRight": {
          e.preventDefault();
          typeAhead.current.clear();
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
          typeAhead.current.clear();
          if (node.ui?.expanded && node.childIds.length > 0) {
            onToggle(selectedId);
          } else if (node.parentId) {
            onSelect(node.parentId);
          }
          break;
        }

        case "Enter": {
          e.preventDefault();
          typeAhead.current.clear();
          onActivate(selectedId);
          break;
        }

        case " ": {
          e.preventDefault();
          typeAhead.current.clear();
          if (node.childIds.length > 0) {
            onToggle(selectedId);
          }
          break;
        }

        case "Home": {
          e.preventDefault();
          typeAhead.current.clear();
          onSelect(visibleNodeIds[0]);
          break;
        }

        case "End": {
          e.preventDefault();
          typeAhead.current.clear();
          onSelect(visibleNodeIds[visibleNodeIds.length - 1]);
          break;
        }

        case "*": {
          // Expand all siblings
          e.preventDefault();
          typeAhead.current.clear();
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

        default: {
          tryTypeAhead(currentIndex);
          break;
        }
      }
    },
    [
      nodes,
      visibleNodeIds,
      selectedId,
      onSelect,
      onToggle,
      onActivate,
      onFocusSearch,
    ],
  );

  return { handleKeyDown };
}
