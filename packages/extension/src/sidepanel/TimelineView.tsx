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

import { useEffect, useRef } from "preact/hooks";

import { NativeViewToggle, type NativeView } from "./NativeTabView.js";
import { isRecording, timelineStatus } from "./timeline-state.js";
import { useTimeline, type Timeline } from "./use-timeline.js";

/** Where focus was when the view came up, if the switch to it left focus
 *  nowhere: on the panel's body, or on the tree's toggle, which hides with
 *  the tree. */
function focusLost(): boolean {
  const active = document.activeElement;
  return (
    !active ||
    active === document.body ||
    active.closest(".sn-view--hidden") !== null
  );
}

type TimelineViewProps = Timeline & {
  onViewChange: (view: NativeView) => void;
};

/** The view's toolbar: the view toggle, Record or Stop, Clear, Copy, and
 *  the status line. */
function TimelineControls({
  state,
  record: onRecord,
  stop: onStop,
  clear: onClear,
  copy: onCopy,
  onViewChange,
}: TimelineViewProps) {
  const running = isRecording(state);
  const empty = state.lines.length === 0;
  const toolbar = useRef<HTMLDivElement>(null);
  // Chosen from the tree's toolbar, whose toggle hides with the tree: focus
  // goes on to this view's own.
  useEffect(() => {
    if (!focusLost()) return;
    toolbar.current
      ?.querySelector<HTMLElement>('.sn-toggle-btn[aria-pressed="true"]')
      ?.focus();
  }, []);
  return (
    <div
      ref={toolbar}
      class="sn-toolbar sn-toolbar--wrap"
      role="toolbar"
      aria-label="Timeline controls"
    >
      <NativeViewToggle view="timeline" onViewChange={onViewChange} />
      {/* One button, so focus stays on it as it turns from one to the
          other. */}
      <button
        class={`sn-toolbar-btn ${running ? "sn-timeline-stop" : "sn-timeline-record"}`}
        onClick={running ? onStop : onRecord}
        title={
          running
            ? "Stop recording"
            : "Record focus moves and announcements as you use the page"
        }
      >
        {running ? "■ Stop" : "● Record"}
      </button>
      {/* `aria-disabled`, not `disabled`: a disabled button loses focus,
          and Clear is pressed with focus on it. */}
      <button
        class="sn-toolbar-btn sn-timeline-clear"
        aria-disabled={empty}
        onClick={() => !empty && onClear()}
      >
        Clear
      </button>
      <button
        class="sn-toolbar-btn sn-timeline-copy"
        aria-disabled={empty}
        onClick={() => !empty && onCopy()}
        title="Copy the lines as text — the lines recordTimeline prints"
      >
        Copy
      </button>
      {/* Mounted before it has anything to say: a live region that arrives
          holding text is not announced. It changes as recording starts and
          stops, never per line. */}
      <span class="sn-timeline-status" role="status">
        {timelineStatus(state)}
      </span>
    </div>
  );
}

/** The recording (`useTimeline`): its state, and what each control does.
 *  `highlight` shows a line's node on the page.
 *
 * @internal Extension-only. Not a stability promise.
 */
export function TimelineView(props: TimelineViewProps) {
  const { state, highlight: onHighlight } = props;
  return (
    <div class="sn-timeline">
      <TimelineControls {...props} />
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

/**
 * The recording (`useTimeline`) and its view, for App to show while TIMELINE
 * is chosen: in the tree's place, and on the screen the panel shows while no
 * page is connected, after a navigation to one no content script can run on
 * (a PDF, say), where the finished recording can still be read and copied.
 *
 * @internal Extension-only. Not a stability promise.
 */
export function useTimelineView(
  ...[myTabId, send, announce, onViewChange]: [
    ...Parameters<typeof useTimeline>,
    (view: NativeView) => void,
  ]
) {
  const timeline = useTimeline(myTabId, send, announce);
  return <TimelineView {...timeline} onViewChange={onViewChange} />;
}
