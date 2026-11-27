// The timeline recorder's events and options: what a caller outside core
// reads, kept apart from the recorder that makes them.

import type { A11yInfo } from "../types.js";

import type { Level } from "./timeline-regions.js";

/**
 * Focus came to rest somewhere new for the timeline to name.
 *
 * @internal Read by the timeline view's surfaces (ADR-0002). Not a
 * stability promise.
 */
export interface TimelineFocusEvent {
  kind: "focus";
  /**
   * The focused node as the tab order singles it out: its a11y facet, with a
   * sensitive field's choice withheld as `getTabSequence` withholds it
   * (ADR-0001), and without its value. Null when focus rests on `<body>` or
   * `<html>`, or outside the root: a `(none)` line.
   */
  stop: Omit<A11yInfo, "value"> | null;
  /** Assistive tech can't reach it: inside `aria-hidden`, `inert` or hidden
   *  content, or somewhere the tree doesn't walk at all. */
  hidden: boolean;
}

/**
 * A live region showed text it hadn't said.
 *
 * @internal Read by the timeline view's surfaces (ADR-0002). Not a
 * stability promise.
 */
export interface TimelineAnnounceEvent {
  kind: "announce";
  /** The region's role. */
  role: string;
  /** All the text the region shows, on one line. */
  text: string;
  /** How the region announces. */
  live: Level;
}

/**
 * One thing a keyboard and screen-reader user met, in order. The field-value
 * gates have run: no field's value, and no sensitive field's chosen option.
 * A user's `redact` patterns have not; `serializeTimeline` applies them, and
 * a caller that hands events on itself must too.
 *
 * @internal Read by the timeline view's surfaces (ADR-0002). Not a
 * stability promise.
 */
export type TimelineEvent = TimelineFocusEvent | TimelineAnnounceEvent;

/**
 * How `startTimeline` records.
 *
 * @internal Read by the timeline view's surfaces (ADR-0002). Not a
 * stability promise.
 */
export interface TimelineOptions {
  /** Record focus moves. Default `true`. */
  focus?: boolean;
  /** Record live-region announcements. Default `true`. */
  announcements?: boolean;
  /**
   * Called with where focus starts once `startTimeline` has returned, and
   * with each run of events as the page's synchronous block settles, so a
   * caller outside the page can take them out before a navigation replaces
   * it (ADR-0002).
   */
  onEvents?: (events: readonly TimelineEvent[]) => void;
}

/**
 * A running recorder, from `startTimeline`.
 *
 * @internal Read by the timeline view's surfaces (ADR-0002). Not a
 * stability promise.
 */
export interface TimelineRecording {
  /** Stop recording and return every event, in order. Later calls return
   *  the same events. */
  stop(): readonly TimelineEvent[];
}

/** `event`, and the stop it names, made read-only: `stop()` and `onEvents`
 *  hand out the same events, which no reader can then change for another. */
export function freeze(event: TimelineEvent): TimelineEvent {
  if (event.kind === "focus" && event.stop) {
    Object.freeze(event.stop.states);
    Object.freeze(event.stop.properties);
    Object.freeze(event.stop);
  }
  return Object.freeze(event);
}

/** The stop of a focused element the tree doesn't walk at all: its role,
 *  and nothing assistive tech could say of it. */
export function unreached(role: string): Omit<A11yInfo, "value"> {
  return {
    role,
    name: "",
    description: "",
    states: {},
    properties: {},
    isExposedToAT: false,
  };
}

/**
 * Why `root` and `options` can't start a timeline, or null when they can.
 * A caller names itself in front of it, as `testing`'s `recordTimeline`
 * does, so the error says which call it came from.
 *
 * @internal For `startTimeline`'s callers. Not a stability promise.
 */
export function timelineProblem(
  root: unknown,
  options: Pick<TimelineOptions, "focus" | "announcements"> = {},
): string | null {
  if (typeof Element === "undefined" || !(root instanceof Element)) {
    return `expected a DOM Element, received ${root === null ? "null" : typeof root}`;
  }
  // A recorder that listens for nothing records nothing forever, whatever
  // the page does: a test that can't fail.
  if (options.focus === false && options.announcements === false) {
    return "{ focus: false, announcements: false } records nothing. Leave one of them on.";
  }
  // Its changes would never reach the document's observer. Through the
  // prototype: a `<form>`'s control named `isConnected` shadows its own.
  const isConnected = Object.getOwnPropertyDescriptor(
    Node.prototype,
    "isConnected",
  )!.get!;
  if (!isConnected.call(root)) {
    return "the root isn't in the document, so nothing it does would be seen. Attach it first.";
  }
  return null;
}
