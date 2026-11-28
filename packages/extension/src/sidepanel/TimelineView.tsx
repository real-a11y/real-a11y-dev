/**
 * The TIMELINE view (ADR-0002), in the tree's place: where focus went and what live regions
 * announced while the user used the page, one line each, in the order the
 * page made them. Recorded in the page's top frame by core's recorder, as
 * the TAB view's stops come from the page's own walk; App holds the lines
 * (`timeline-state.ts`).
 *
 * The list is not itself a live region: a line a second, each read out,
 * would talk over the page a screen-reader tester is listening to. The
 * status line says when recording starts and stops.
 */

import { NativeViewToggle, type NativeView } from "./NativeTabView.js";
import { isRecording, timelineStatus } from "./timeline-state.js";
import type { Timeline } from "./use-timeline.js";

/** The recording (`useTimeline`): its state, and what each control does.
 *  `highlight` shows a line's node on the page. */
export function TimelineView({
  state,
  record: onRecord,
  stop: onStop,
  clear: onClear,
  copy: onCopy,
  highlight: onHighlight,
  onViewChange,
}: Timeline & { onViewChange: (view: NativeView) => void }) {
  const running = isRecording(state);
  const empty = state.lines.length === 0;
  return (
    <div class="sn-timeline">
      <div
        class="sn-toolbar sn-toolbar--wrap"
        role="toolbar"
        aria-label="Timeline controls"
      >
        <NativeViewToggle view="timeline" onViewChange={onViewChange} />
        {running ? (
          <button
            class="sn-toolbar-btn sn-timeline-stop"
            onClick={onStop}
            title="Stop recording"
          >
            {"■ Stop"}
          </button>
        ) : (
          <button
            class="sn-toolbar-btn sn-timeline-record"
            onClick={onRecord}
            title="Record focus moves and announcements as you use the page"
          >
            {"● Record"}
          </button>
        )}
        <button
          class="sn-toolbar-btn sn-timeline-clear"
          onClick={onClear}
          disabled={empty}
        >
          Clear
        </button>
        <button
          class="sn-toolbar-btn sn-timeline-copy"
          onClick={onCopy}
          disabled={empty}
          title="Copy the lines as text — the lines recordTimeline prints"
        >
          Copy
        </button>
        {/* Mounted before it has anything to say: a live region that
            arrives holding text is not announced. */}
        <span class="sn-timeline-status" role="status">
          {timelineStatus(state)}
        </span>
      </div>
      <ol class="sn-timeline-lines" aria-label="Timeline">
        {state.lines.map((line) => (
          <li key={line.id} class="sn-timeline-item">
            {state.linked && line.nodeId !== undefined ? (
              <button
                class="sn-timeline-line"
                title="Show on the page"
                onClick={() => onHighlight(line.nodeId!)}
              >
                {line.text}
              </button>
            ) : (
              <span class="sn-timeline-line">{line.text}</span>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
