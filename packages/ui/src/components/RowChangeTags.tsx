/**
 * What the last read found on a row (`tree-changes.ts`), as tags after its
 * key states, where nothing clips them: _new_ on the top row of a new
 * subtree, _changed_ with what changed in its title, and what a row stands
 * in for under it (_2 new inside_). Hidden from a screen reader, which hears
 * the same at the end of the row's label (`marksForReaders`).
 */

import {
  describeChange,
  hiddenChangesText,
  type RowChangeMarks,
} from "../tree-changes.js";

export function RowChangeTags({ marks }: { marks: RowChangeMarks }) {
  const { hidden } = marks;
  return (
    <>
      {marks.newTop && (
        <span
          class="sn-change-tag sn-change-tag--new"
          aria-hidden="true"
          title="New since the read before"
        >
          new
        </span>
      )}
      {marks.changes && (
        <span
          class="sn-change-tag sn-change-tag--changed"
          aria-hidden="true"
          title={[
            "Changed since the read before:",
            ...marks.changes.map(describeChange),
          ].join("\n")}
        >
          changed
        </span>
      )}
      {/* Keyed on when its flash ends, so a later read that flashes another
          change under the row starts the tag's flash over. */}
      {hidden && (
        <span
          key={hidden.fresh ? hidden.flashUntil : "still"}
          class={`sn-change-tag sn-change-tag--inside${hidden.fresh ? " sn-change-tag--flash" : ""}`}
          aria-hidden="true"
          title={`Under this row, since the read before: ${hiddenChangesText(hidden)}`}
        >
          {hiddenChangesText(hidden)}
        </span>
      )}
    </>
  );
}
