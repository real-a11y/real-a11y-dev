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
 * A modifier held with a {@link TimelinePressEvent}'s key, in the order a
 * line prints them: `Ctrl+Alt+Shift+Meta+…`.
 *
 * @internal Read by the timeline view's surfaces (ADR-0002). Not a
 * stability promise.
 */
export type TimelineModifier = "Ctrl" | "Alt" | "Shift" | "Meta";

/**
 * A key that types no text reached the page: a `keydown` whose key is one
 * the recorder names (`Tab`, `Enter`, `Escape`, an arrow, …), `Space` where
 * it types nothing, or a character held with `Ctrl` or `Meta` as a shortcut.
 * Never a key that types a character (ADR-0001).
 *
 * @internal Read by the timeline view's surfaces (ADR-0002). Not a
 * stability promise.
 */
export interface TimelinePressEvent {
  kind: "press";
  /** The key's name: `Tab`, `ArrowDown`, `Space`, or a shortcut's
   *  character, upper-cased (`A` for `Ctrl+A`). */
  key: string;
  /** The modifiers held with it, in {@link TimelineModifier}'s order. */
  modifiers: readonly TimelineModifier[];
}

/**
 * A `click` event reached the page, from a pointer, a key that activates
 * (`Enter` on a button) or script.
 *
 * @internal Read by the timeline view's surfaces (ADR-0002). Not a
 * stability promise.
 */
export interface TimelineClickEvent {
  kind: "click";
  /**
   * What was clicked, named as a focus event names a stop: the nearest node
   * the a11y tree keeps, from the event's target up (a click on a button's
   * icon names the button), or the target's DOM-view node, such as
   * `generic`, when none does. No value, and a sensitive field's choice
   * withheld.
   */
  target: Omit<A11yInfo, "value">;
  /** Assistive tech can't reach the element clicked. */
  hidden: boolean;
}

/**
 * Text was typed into a field: one or more `input` events on a text field
 * or an editor, with nothing else recorded between them. Names the field,
 * never the characters (ADR-0001): no `input` or `beforeinput` data, no key,
 * no clipboard content. A sensitive field (a password, a card number) gets
 * its role and name alone.
 *
 * @internal Read by the timeline view's surfaces (ADR-0002). Not a
 * stability promise.
 */
export interface TimelineTypeEvent {
  kind: "type";
  /** The field, named as a focus event names a stop, without its value. */
  target: Omit<A11yInfo, "value">;
  /** Assistive tech can't reach the field. */
  hidden: boolean;
}

/**
 * Something the user did to the page, with `{ interactions: true }`.
 *
 * @internal Read by the timeline view's surfaces (ADR-0002). Not a
 * stability promise.
 */
export type TimelineInteractionEvent =
  TimelinePressEvent | TimelineClickEvent | TimelineTypeEvent;

/**
 * One thing a keyboard and screen-reader user met, or did, in order. The
 * field-value gates have run: no field's value, no sensitive field's chosen
 * option, and no typed character. A user's `redact` patterns have not;
 * `serializeTimeline` applies them, and a caller that hands events on itself
 * must too.
 *
 * @internal Read by the timeline view's surfaces (ADR-0002). Not a
 * stability promise.
 */
export type TimelineEvent =
  TimelineFocusEvent | TimelineAnnounceEvent | TimelineInteractionEvent;

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
   * Record what the user did to the page: clicks, keys that type no text,
   * and typing into a field (never what was typed). Default `false`, so a
   * timeline recorded before it existed reads as it did.
   */
  interactions?: boolean;
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

/** `event`, and the node it names, made read-only: `stop()` and `onEvents`
 *  hand out the same events, which no reader can then change for another. */
export function freeze(event: TimelineEvent): TimelineEvent {
  const named =
    event.kind === "focus"
      ? event.stop
      : event.kind === "click" || event.kind === "type"
        ? event.target
        : null;
  if (named) {
    Object.freeze(named.states);
    Object.freeze(named.properties);
    Object.freeze(named);
  }
  if (event.kind === "press") Object.freeze(event.modifiers);
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
  options: Pick<
    TimelineOptions,
    "focus" | "announcements" | "interactions"
  > = {},
): string | null {
  if (typeof Element === "undefined" || !(root instanceof Element)) {
    return `expected a DOM Element, received ${root === null ? "null" : typeof root}`;
  }
  // A recorder that listens for nothing records nothing forever, whatever
  // the page does: a test that can't fail.
  if (
    options.focus === false &&
    options.announcements === false &&
    !options.interactions
  ) {
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
