// The timeline view's lines: one per event core's recorder records, in the
// order it recorded them.

import {
  impliedLiveLevel,
  type SemanticNode,
  type TimelineEvent,
} from "@real-a11y-dev/core";

import { redactString, serializeTabStop } from "./serialize.js";

/** One line, `focus     …` or `announce  …`. */
function line(kind: TimelineEvent["kind"], text: string): string {
  return `${kind.padEnd(10)}${text}`;
}

/** A focus event's text: the stop as the tab order prints it, `[hidden]`
 *  when assistive tech can't reach it, or `(none)`. */
function focusText(
  event: Extract<TimelineEvent, { kind: "focus" }>,
  redact: RegExp[] | undefined,
): string {
  if (!event.stop) return "(none)";
  const node: SemanticNode = {
    id: "",
    parentId: null,
    childIds: [],
    depth: 0,
    a11y: event.stop,
  };
  const stop = serializeTabStop(node, { redact });
  return event.hidden ? `${stop} [hidden]` : stop;
}

/** An announce event's text: the region's role and what it says, with
 *  `{live=…}` when its `aria-live` sets a politeness the role doesn't imply. */
function announceText(
  event: Extract<TimelineEvent, { kind: "announce" }>,
  redact: RegExp[] | undefined,
): string {
  const live =
    impliedLiveLevel(event.role) === event.live ? "" : ` {live=${event.live}}`;
  return `${event.role} "${redactString(event.text, redact)}"${live}`;
}

/**
 * A timeline's events as lines, `(nothing recorded)` when there are none:
 *
 * ```
 * focus     button "Delete draft"
 * announce  status "Deleting…"
 * focus     (none)
 * focus     button "New draft"
 * announce  status "Draft deleted." {live=assertive}
 * ```
 *
 * `redact` masks matching text in focused names and announced text, as the
 * other snapshots mask names. The field-value gates are the recorder's: an
 * event never carries a value or a withheld choice that a line would leave
 * out. `redact` is not: the events carry the text before it, so a caller
 * that hands events on, rather than lines, applies its patterns itself.
 *
 * @internal The timeline view's one line format, for every surface
 * (ADR-0002): `testing`'s `recordTimeline` today. Not a stability promise.
 */
export function serializeTimeline(
  events: readonly TimelineEvent[],
  options: { redact?: RegExp[] } = {},
): string {
  const { redact } = options;
  const lines = events.map((event) =>
    event.kind === "focus"
      ? line("focus", focusText(event, redact))
      : line("announce", announceText(event, redact)),
  );
  return lines.length ? lines.join("\n") : "(nothing recorded)";
}
