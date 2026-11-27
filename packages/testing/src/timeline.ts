// A timeline of what a keyboard and screen-reader user meets during an
// interaction: where focus goes, and what live regions announce, in order.
// `capture()` + `a11yDiff()` see the page at two moments; this records what
// happens between them. The recorder is core's and the lines serialize's,
// as on every surface (ADR-0002); this boxes them for a snapshot.

import { startTimeline, timelineProblem } from "@real-a11y-dev/core";
import { serializeTimeline } from "@real-a11y-dev/serialize";

import { boxSnapshot, type A11ySnapshotBox } from "./snapshot-box.js";

export interface RecordTimelineOptions {
  /**
   * Redact matching substrings from focused nodes' names and from announced
   * text, as the other snapshots redact names.
   */
  redact?: RegExp[];
  /** Record focus moves. Default `true`. */
  focus?: boolean;
  /** Record live-region announcements. Default `true`. */
  announcements?: boolean;
}

/** A running recorder, from {@link recordTimeline}. */
export interface A11yTimeline {
  /**
   * Stop recording and box what was recorded, for
   * `expect(...).toMatchSnapshot()`. Later calls return the same box.
   */
  stop(): A11ySnapshotBox;
}

/**
 * Record what a keyboard and screen-reader user meets from now on, in order:
 * where focus goes, and what live regions announce. Start it before the
 * interaction, wait for the page's last change, then box the result with
 * `stop()`:
 *
 * ```ts
 * const timeline = recordTimeline(document.body);
 * await user.click(screen.getByRole("button", { name: "Delete draft" }));
 * await screen.findByText("Draft deleted.");
 * expect(timeline.stop()).toMatchInlineSnapshot(`
 *   focus     button "Delete draft"
 *   announce  status "Deleting…"
 *   focus     (none)
 *   focus     button "New draft"
 *   announce  status "Draft deleted."
 * `);
 * ```
 *
 * - A **focus** line names the focused node as a tab stop prints it,
 *   `role "name" {states}`, with `[hidden]` when assistive tech can't reach
 *   it. `(none)` means focus rests on `<body>` or `<html>`, or outside the
 *   root. The first line is where focus starts, unless it starts on nothing.
 *   (In the example, React renders the status after the handler's `focus()`
 *   has run, so focus lands first.)
 * - An **announce** line is the text a live region gains: an element with
 *   `aria-live="polite"` or `"assertive"`, or a `status` (an `<output>` too),
 *   `alert` or `log`. It names the region's role, and `{live=…}` when
 *   `aria-live` sets a politeness the role doesn't imply. Only text nodes are
 *   read: an image's `alt` or an `aria-label` inside the region isn't. A
 *   region emptied prints nothing, and so does the same text set again;
 *   emptied, removed or hidden first, by itself or a container, it prints
 *   again. One hidden by `aria-hidden` or `inert` above it keeps its text,
 *   and one switched to `aria-live="off"` takes in what it shows silently.
 * - Lines follow the order the page made its changes. What one synchronous
 *   run of the page's code does is read once: text set and cleared in it, or
 *   focus passing through an element, prints nothing. Anything an `await`
 *   separates is read separately, even an `await` of a resolved promise.
 *
 * Only what the root holds is recorded, so pass `document.body` to hear the
 * whole page; a root not in the document throws. Changes inside a shadow
 * root aren't seen as they happen: a `MutationObserver` doesn't reach them.
 * Call `stop()` even when a test fails first (in a `finally` or
 * `afterEach`), or the recorder keeps listening.
 */
export function recordTimeline(
  root: Element,
  options: RecordTimelineOptions = {},
): A11yTimeline {
  const { focus, announcements, redact } = options;
  const problem = timelineProblem(root, { focus, announcements });
  if (problem) throw new TypeError(`recordTimeline: ${problem}`);
  const recording = startTimeline(root, { focus, announcements });
  let box: A11ySnapshotBox | undefined;
  return {
    stop: () =>
      (box ??= boxSnapshot(serializeTimeline(recording.stop(), { redact }))),
  };
}
