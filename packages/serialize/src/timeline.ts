// The timeline view's lines: one per event core's recorder records, in the
// order it recorded them.

import {
  impliedLiveLevel,
  type SemanticNode,
  type TimelineEvent,
  type TimelineFocusEvent,
} from "@real-a11y-dev/core";

import { redactString, serializeTabStop } from "./serialize.js";

/** One line, `focus     …`, `announce  …`, `click     …`. */
function line(kind: TimelineEvent["kind"], text: string): string {
  return `${kind.padEnd(10)}${text}`;
}

/** A node as the tab order prints a stop, with `[hidden]` when assistive
 *  tech can't reach it. */
function stopText(
  a11y: NonNullable<TimelineFocusEvent["stop"]>,
  hidden: boolean,
  redact: RegExp[] | undefined,
): string {
  const node: SemanticNode = {
    id: "",
    parentId: null,
    childIds: [],
    depth: 0,
    a11y,
  };
  const stop = serializeTabStop(node, { redact });
  return hidden ? `${stop} [hidden]` : stop;
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

/** An event's line. */
function eventLine(event: TimelineEvent, redact: RegExp[] | undefined): string {
  switch (event.kind) {
    case "focus":
      return line(
        "focus",
        event.stop ? stopText(event.stop, event.hidden, redact) : "(none)",
      );
    case "announce":
      return line("announce", announceText(event, redact));
    case "press":
      return line("press", [...event.modifiers, event.key].join("+"));
    case "click":
    case "type":
      return line(event.kind, stopText(event.target, event.hidden, redact));
  }
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
 * With interactions recorded, `press     Shift+Tab` is a key that types no
 * text, `click     button "Save"` a click the page received, and
 * `type      textbox "Email"` typing into a field: the field, never what was
 * typed, which no event carries.
 *
 * `redact` masks matching text in the names lines print and announced text, as the
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
  const lines = events.map((event) => eventLine(event, redact));
  return lines.length ? lines.join("\n") : "(nothing recorded)";
}
