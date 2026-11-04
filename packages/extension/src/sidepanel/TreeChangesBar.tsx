/**
 * The line under Chrome's tree while it marks what the last read found
 * changed (`tree-changes.ts`): how many rows are new, changed and removed,
 * the way to the previous and next change for a pointer, a way to clear the
 * marks, and the removed rows, which have no row of their own to mark,
 * listed as the shared panel lists the rows removed since its checkpoint.
 * The keys, Alt+Shift+N and Alt+N, are the tree's, so the arrows name them
 * in their titles only, as a jump chip names Alt+J: they do nothing here.
 */

import type { NativeTreeChanges } from "../native/native-tree-diff.js";

import {
  CHANGE_KEYS,
  MAX_REMOVED_LISTED,
  summarizeChanges,
} from "./tree-changes.js";
import type { ChangeNotice } from "./use-tree-changes.js";

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
}: {
  changes: NativeTreeChanges;
  onPrevious: () => void;
  onNext: () => void;
  /** Left out without it. */
  onClear?: () => void;
}) {
  const listed = changes.removed.slice(0, MAX_REMOVED_LISTED);
  return (
    <div
      class="sn-changes-bar"
      role="group"
      aria-label="Changes since the read before"
    >
      <div class="sn-changes-line">
        <span
          class="sn-changes-summary"
          title="What this read of the page found new, changed or removed since the read before it"
        >
          {summarizeChanges(changes)}
        </span>
        {changes.stops.length > 0 && (
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
      {changes.removed.length > 0 && (
        <details class="sn-removed">
          <summary class="sn-removed-summary">Removed rows</summary>
          <ul class="sn-removed-list">
            {listed.map((node) => (
              <li key={node.id} class="sn-removed-item">
                {node.role}
                {node.name ? ` "${node.name}"` : ""}
              </li>
            ))}
            {changes.removed.length > listed.length && (
              <li class="sn-removed-item sn-removed-item--more">
                … and {changes.removed.length - listed.length} more
              </li>
            )}
          </ul>
        </details>
      )}
    </div>
  );
}
