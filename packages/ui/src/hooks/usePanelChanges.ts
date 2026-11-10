/**
 * The change marks as `TreePanel.tsx` shows them, through `useTreeChanges`.
 * The panel keeps a row open on its node (`ui.expanded`) rather than in a
 * set, so this hands the hook the rows open as a set, and opens the rows a
 * read opens on their nodes.
 */

import type { DomSemanticNode, ExtractionResult } from "@real-a11y-dev/core";
import { useCallback, useMemo } from "preact/hooks";

import type { TreeChangesProp } from "../tree-changes.js";

import { useTreeChanges } from "./useTreeChanges.js";

/** No rows: what a panel that marks no changes hands the hook. */
const NO_ROWS = new Set<string>();
const NO_PARENTS: ReadonlyMap<string, string> = new Map();

/** Each row's parent, as the marks climb from a row. */
function parentIndex(nodes: ExtractionResult["nodes"]): Map<string, string> {
  const parentOf = new Map<string, string>();
  for (const [id, node] of nodes) {
    if (node.parentId !== null) parentOf.set(id, node.parentId);
  }
  return parentOf;
}

/** The rows open on their nodes. */
function openRowsOf(nodes: ExtractionResult["nodes"]): Set<string> {
  const open = new Set<string>();
  for (const [id, node] of nodes) if (node.ui?.expanded) open.add(id);
  return open;
}

export function usePanelChanges({
  treeData,
  renderCount,
  forceRender,
  changes,
  selectedId,
  jumpTo,
}: {
  treeData: ExtractionResult;
  /** Moves whenever the panel changes a node in place (`ui.expanded`). */
  renderCount: number;
  forceRender: () => void;
  changes: TreeChangesProp | undefined;
  selectedId: string | null;
  jumpTo: (id: string) => void;
}) {
  const marking = changes !== undefined;
  const { nodes, rootId } = treeData;
  const parentOf = useMemo(
    () => (marking ? parentIndex(nodes) : NO_PARENTS),
    [nodes, marking],
  );
  const openRows = useMemo(
    () => (marking ? openRowsOf(nodes) : NO_ROWS),
    // renderCount moves when a row opens or closes on its node.
    [nodes, renderCount, marking],
  );
  const setExpanded = useCallback(
    (update: (open: Set<string>) => Set<string>) => {
      const next = update(openRows);
      if (next === openRows) return;
      const setOpen = (id: string, open: boolean) => {
        const node = nodes.get(id) as DomSemanticNode | undefined;
        if (node) node.ui.expanded = open;
      };
      for (const id of next) if (!openRows.has(id)) setOpen(id, true);
      for (const id of openRows) if (!next.has(id)) setOpen(id, false);
      forceRender();
    },
    [nodes, openRows, forceRender],
  );
  const view = useTreeChanges({
    changes: changes?.marks ?? null,
    nodes,
    rootId,
    parentOf,
    selectedId,
    expanded: openRows,
    setExpanded,
    jumpTo,
    since: changes?.since,
    noticeEnd: changes?.noticeEnd,
    totals: changes?.totals,
  });
  // Null while nothing is marked: the rows open are the nodes' own.
  return { view, parentOf, open: marking ? view.expanded : null };
}
