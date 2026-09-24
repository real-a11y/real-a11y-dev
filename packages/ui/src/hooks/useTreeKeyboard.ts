import type { ActionType, SemanticNode } from "@real-a11y-dev/core";
import { useCallback, useRef } from "preact/hooks";

import { resolveStepperKeyAction } from "./stepperKeys.js";
import {
  createTypeAheadBuffer,
  findTypeAheadIndex,
  isTypeAheadKey,
} from "./typeAhead.js";
import { useIndexById } from "./useIndexById.js";

interface UseTreeKeyboardOptions {
  nodes: Map<string, SemanticNode>;
  visibleNodeIds: string[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  /**
   * Activate the selected node. Optional `action` lets stepper keys
   * (`+`/`-`/`Shift+Enter`) dispatch increment/decrement explicitly —
   * without it, Enter always hits `getPrimaryAction` which prefers
   * increment, so a keyboard user could never lower a slider.
   */
  onActivate: (id: string, action?: ActionType) => void;
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

  // Row id → position, so neither the per-keypress index lookup nor
  // ArrowRight's "is this child visible?" check scans the list.
  //
  // Both panels also hold this map for their own lookups, so the list is
  // walked twice per change. Taking it as an option instead was tried and
  // backed out: it buys one O(N) walk per *list change* — the same order as
  // building the list — at the cost of coupling the hook to its callers and
  // ~20 bytes that put the ui bundle exactly on its size-limit ceiling. Not
  // worth it; the win here is the per-keypress scans, which are gone either
  // way.
  const indexById = useIndexById(visibleNodeIds);

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

      const currentIndex = indexById.get(selectedId) ?? -1;
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
                indexById.has(id),
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
          // Shift+Enter decrements a slider/spinbutton; plain Enter keeps
          // going through getPrimaryAction (increment for steppers).
          const step = resolveStepperKeyAction(
            e,
            node.interaction?.actions ?? [],
          );
          onActivate(selectedId, step ?? undefined);
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
          // +/- step a slider/spinbutton before type-ahead claims the key.
          const step = resolveStepperKeyAction(
            e,
            node.interaction?.actions ?? [],
          );
          if (step) {
            e.preventDefault();
            typeAhead.current.clear();
            onActivate(selectedId, step);
            break;
          }
          tryTypeAhead(currentIndex);
          break;
        }
      }
    },
    [
      nodes,
      visibleNodeIds,
      indexById,
      selectedId,
      onSelect,
      onToggle,
      onActivate,
      onFocusSearch,
    ],
  );

  return { handleKeyDown };
}
