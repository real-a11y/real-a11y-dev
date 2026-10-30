/**
 * The TAB view of Chrome's tree (`NativeTreeView.tsx`). A native node carries
 * no tab order (`tabindex` never reaches one), so the view shows the in-page
 * walk's (`TabSequenceView`), as the CLI's `tabs` does, and its selection and
 * activation go through the content script, as in the in-page tree's own TAB
 * view. App holds which view shows: the in-page tree's view mode.
 */

import type { ActionType, SemanticNode } from "@real-a11y-dev/core";
import { useMemo } from "preact/hooks";

import { matchCountLabel } from "./scope.js";
import { tabStops } from "./TabSequenceView.js";

/** Chrome's tree, or the page's tab order in its place. */
export type NativeView = "a11y" | "tab";

/** The page's tab order: the in-page tree it comes from, and what selecting
 *  and activating a stop does there. Named as `TabSequenceView`'s props. */
export interface NativeTabOrder {
  nodes: Map<string, SemanticNode>;
  rootId: string;
  onHighlight: (nodeId: string) => void;
  onActivate: (nodeId: string, action?: ActionType) => void;
}

/** The toolbar's A11Y / TAB switch. */
export function NativeViewToggle({
  view,
  onViewChange,
}: {
  view: NativeView;
  onViewChange: (view: NativeView) => void;
}) {
  return (
    <div class="sn-toggle-group" role="group" aria-label="Native tree view">
      {(["a11y", "tab"] as const).map((v) => (
        <button
          key={v}
          class="sn-toggle-btn"
          aria-pressed={view === v}
          onClick={() => onViewChange(v)}
        >
          {v === "a11y" ? "A11Y" : "TAB"}
        </button>
      ))}
    </div>
  );
}

/** The search's count while the tab order shows: the stops it leaves, and
 *  nothing with no search, as the tree's count. */
export function useTabMatchLabel(
  shown: NativeTabOrder | undefined,
  query: string,
): string | false {
  return useMemo(
    () =>
      shown !== undefined &&
      query.trim().length > 0 &&
      matchCountLabel(tabStops(shown.nodes, shown.rootId, query).length, false),
    [shown, query],
  );
}
