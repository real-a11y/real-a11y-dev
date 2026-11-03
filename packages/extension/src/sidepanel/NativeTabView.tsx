/**
 * The TAB view of Chrome's tree (`NativeTreeView.tsx`). A native node carries
 * no tab order (`tabindex` never reaches one), so the view shows the page's
 * own walk's (`TabSequenceView`), as the CLI's `tabs` does, and its selection
 * and activation go through the content script. The order is
 * `getTabSequence`'s, which doesn't model shadow roots, iframes or focus
 * traps. App holds which view shows.
 */

import type { ComponentProps } from "preact";
import { useMemo } from "preact/hooks";

import { matchCountLabel } from "./scope.js";
import { TabSequenceView, tabStops } from "./TabSequenceView.js";

/** Chrome's tree, or the page's tab order in its place. */
export type NativeView = "a11y" | "tab";

/** The page's tab order: the walk it comes from, and what selecting and
 *  activating a stop does there. */
export type NativeTabOrder = Pick<
  ComponentProps<typeof TabSequenceView>,
  "nodes" | "rootId" | "pending" | "onHighlight" | "onActivate"
>;

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
  // Keyed on the tree, not on `shown`: App hands over a new object each
  // render, and the walk is the page's whole tab sequence.
  const nodes = shown?.nodes;
  const rootId = shown?.rootId;
  return useMemo(
    () =>
      nodes !== undefined &&
      rootId !== undefined &&
      query.trim().length > 0 &&
      matchCountLabel(tabStops(nodes, rootId, query).length, false),
    [nodes, rootId, query],
  );
}
