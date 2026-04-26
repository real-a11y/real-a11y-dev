import type { RefObject } from "react";
import { useSemanticTree } from "@real-a11y-dev/react";
import { findAllByRole } from "@real-a11y-dev/core";

interface Props {
  rootRef: RefObject<Element | null>;
}

/**
 * Displays a live count of unlabeled interactive elements in the subtree.
 * Re-renders automatically when the DOM changes.
 */
export function IssuesBadge({ rootRef }: Props) {
  const tree = useSemanticTree(rootRef);

  if (!tree) return null;

  const unlabeled = [
    ...findAllByRole(tree, "button"),
    ...findAllByRole(tree, "link"),
    ...findAllByRole(tree, "textbox"),
    ...findAllByRole(tree, "combobox"),
    ...findAllByRole(tree, "checkbox"),
    ...findAllByRole(tree, "radio"),
  ].filter((node) => !node.a11y.name).length;

  if (unlabeled === 0) return null;

  return (
    <span
      role="status"
      aria-label={`${unlabeled} accessibility ${unlabeled === 1 ? "issue" : "issues"} found`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "3px 10px",
        background: "#ffe0e0",
        color: "#c00",
        border: "1px solid #fbb",
        borderRadius: 12,
        fontSize: "0.85rem",
        fontWeight: 600,
      }}
    >
      ⚠ {unlabeled} {unlabeled === 1 ? "issue" : "issues"}
    </span>
  );
}
