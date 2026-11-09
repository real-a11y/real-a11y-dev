/**
 * The line under a tree while it marks what the last read found changed
 * (`tree-changes.ts`): how many rows are new, changed and removed, the way
 * to the previous and next change for a pointer, a way to clear the marks,
 * and the removed rows, which have no row of their own to mark, listed as
 * `TreePanel` lists the rows removed since its checkpoint.
 * The keys, Alt+Shift+N and Alt+N, are the tree's, so the arrows name them
 * in their titles only, as a jump chip names Alt+J: they do nothing here.
 */

import { useLayoutEffect, useRef } from "preact/hooks";

import type { ChangeNotice } from "../hooks/useTreeChanges.js";
import type { TreeChanges } from "../tree-changes-diff.js";
import {
  CHANGE_KEYS,
  MAX_REMOVED_LISTED,
  SINCE_READ_BEFORE,
  summarizeChanges,
} from "../tree-changes.js";

/**
 * Where a read the user caused says what it found changed, and Alt+N that
 * there is no change to go to: politely, and to a screen reader only, as
 * the rows already show it. Mounted empty, as the search count is: a live
 * region that arrives holding its text is not announced by most screen
 * reader and browser pairs.
 */
export function ChangeNoticeRegion({
  notice,
}: {
  notice: ChangeNotice | null;
}) {
  return (
    <span class="sn-sr-only" aria-live="polite">
      {notice && <span key={notice.key}>{notice.text}</span>}
    </span>
  );
}

export function TreeChangesBar({
  changes,
  onPrevious,
  onNext,
  onClear,
  since = SINCE_READ_BEFORE,
}: {
  changes: TreeChanges;
  /** The arrows, left out without them: where no row can be gone to. */
  onPrevious?: () => void;
  onNext?: () => void;
  /** Left out without it. */
  onClear?: () => void;
  /** What the marks are compared with (`TreeChangesProp.since`). */
  since?: string;
}) {
  const bar = useRef<HTMLDivElement>(null);
  useFocusTreeOnLeave(bar);
  return (
    <div
      ref={bar}
      class="sn-changes-bar"
      role="group"
      aria-label={`Changes since ${since}`}
    >
      <div class="sn-changes-line">
        <span
          class="sn-changes-summary"
          title={`Rows new, changed or removed since ${since}`}
        >
          {summarizeChanges(changes)}
        </span>
        {changes.stops.length > 0 && onPrevious && onNext && (
          <>
            <button
              class="sn-toolbar-btn"
              onClick={onPrevious}
              aria-label="Previous change"
              title={`Previous change (${CHANGE_KEYS.back})`}
            >
              ↑
            </button>
            <button
              class="sn-toolbar-btn"
              onClick={onNext}
              aria-label="Next change"
              title={`Next change (${CHANGE_KEYS.forward})`}
            >
              ↓
            </button>
          </>
        )}
        {onClear && (
          <button
            class="sn-toolbar-btn"
            onClick={onClear}
            aria-label="Clear change marks"
            title="Clear change marks"
          >
            ✕
          </button>
        )}
      </div>
      {changes.removed.length > 0 && <RemovedRows rows={changes.removed} />}
    </div>
  );
}

/**
 * When the bar goes with focus in it, as it does when a read finds nothing
 * changed: focus goes to the tree the bar sums up, the one beside it in its
 * panel, or the list a view shows in its place (the TAB view's, a role
 * filter's), rather than to the page's body. On the way out, while the bar
 * still holds what had focus.
 */
function useFocusTreeOnLeave(bar: { current: HTMLElement | null }): void {
  useLayoutEffect(() => {
    const el = bar.current;
    const panel = el?.parentElement;
    return () => {
      // The document's or the shadow root's: a panel mounted in a shadow
      // root, as the inspector's is, holds its focus there.
      const focused = (el?.getRootNode() as Document | ShadowRoot | undefined)
        ?.activeElement;
      if (!el?.contains(focused ?? null)) return;
      panel
        ?.querySelector<HTMLElement>('[role="tree"], [role="listbox"]')
        ?.focus();
    };
  }, []);
}

/** The rows that went, which have no row of their own to mark. */
function RemovedRows({ rows }: { rows: TreeChanges["removed"] }) {
  const listed = rows.slice(0, MAX_REMOVED_LISTED);
  return (
    <details class="sn-removed">
      <summary class="sn-removed-summary">Removed rows</summary>
      <ul class="sn-removed-list">
        {listed.map((node) => (
          <li key={node.id} class="sn-removed-item">
            {node.role}
            {node.name ? ` "${node.name}"` : ""}
          </li>
        ))}
        {rows.length > listed.length && (
          <li class="sn-removed-item sn-removed-item--more">
            … and {rows.length - listed.length} more
          </li>
        )}
      </ul>
    </details>
  );
}
