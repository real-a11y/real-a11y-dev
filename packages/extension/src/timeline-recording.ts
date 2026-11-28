/**
 * The TIMELINE view's recorder in the content script (ADR-0002): core's
 * `startTimeline`, run in the top frame's document, each run of events it
 * settles handed on with the node a line highlights.
 *
 * Core's events name no element: they are what a line prints, for every
 * surface. The panel's lines are clickable, as the other views' rows are, so
 * this finds each event's element itself, at the one moment it can:
 * `onEvents` is called while the block that made the run settles, before any
 * other page code runs.
 *
 * - A focus event names the element focus rests on then. The recorder
 *   settles at most one focus move per block, read from the focused element
 *   at the settle, so that element is the event's. The one exception is
 *   where focus starts: recorded inside `startTimeline` and handed over on a
 *   later microtask, so its element is read when `startTimeline` returns.
 * - An announce event names a live region now showing exactly its text. Two
 *   regions saying the same words are told apart by nothing in the event, so
 *   the innermost last one is taken: a best guess, and a line with no match
 *   is just not clickable.
 *
 * Nothing here is kept beyond the run it hands on: the panel holds the lines,
 * in memory only.
 */

import {
  liveRegionLevel,
  pageText,
  startTimeline,
  type TimelineEvent,
  type TimelineRecording,
} from "@real-a11y-dev/core";

/** Why a recording ended without the panel stopping it. */
export type TimelineEndReason = "navigated" | "document";

/** One event as the panel gets it: the event as core recorded it, and the
 *  node id its line highlights, when one was found. */
export interface TimelineItem {
  event: TimelineEvent;
  nodeId?: string;
}

export interface TimelineHooks {
  /** The element focus rests on now, or null on `<body>`, `<html>` or
   *  nothing. */
  focused: () => Element | null;
  /** The id `HIGHLIGHT_NODE` finds `element` by. */
  idFor: (element: Element) => string;
  /** Hand one run on. */
  send: (items: TimelineItem[]) => void;
}

// Through the prototypes, as the recorder reads them: a page's
// `<img name="createTreeWalker">` shadows the document's own, and a form
// control named `shadowRoot` the form's.
const createTreeWalker = Document.prototype.createTreeWalker;
const shadowRootOf = Object.getOwnPropertyDescriptor(
  Element.prototype,
  "shadowRoot",
)!.get!;

/** One line of text, its white space collapsed, as the recorder writes an
 *  announce event's text. */
function oneLine(text: string): string {
  return text.replace(/[ \t\n\r\f]+/g, " ").trim();
}

/** Is `el` a live region, as the recorder counts one: an authored region, or
 *  an `<output>`. */
function isRegion(el: Element): boolean {
  return liveRegionLevel(el) !== null || el.localName === "output";
}

/** The live region under `root`, open shadow trees included, that shows
 *  exactly `text` now: the last such in document order, which is the
 *  innermost of nested ones. */
export function regionSaying(root: Element, text: string): Element | null {
  let found: Element | null = null;
  const visit = (start: Node) => {
    const walker = createTreeWalker.call(
      root.ownerDocument,
      start,
      NodeFilter.SHOW_ELEMENT,
    );
    for (
      let n: Node | null = start instanceof Element ? start : walker.nextNode();
      n;
      n = walker.nextNode()
    ) {
      const el = n as Element;
      if (
        isRegion(el) &&
        oneLine(pageText(el, { announced: true, lines: true })) === text
      ) {
        found = el;
      }
      const shadow = shadowRootOf.call(el) as ShadowRoot | null;
      if (shadow) visit(shadow);
    }
  };
  visit(root);
  return found;
}

/**
 * Record a timeline of `root`'s document, handing each run to `hooks.send`
 * with the node each line highlights. Throws what `startTimeline` throws.
 */
export function recordTimeline(
  root: Element,
  hooks: TimelineHooks,
): TimelineRecording {
  // Where focus starts, read when `startTimeline` returns: the event for it
  // comes on a later microtask, after the page may have moved focus on.
  let start: Element | null | undefined;
  const targetOf = (
    event: TimelineEvent,
    isStart: boolean,
  ): string | undefined => {
    let el: Element | null = null;
    if (event.kind === "focus") {
      if (event.stop === null) return undefined;
      el = isStart ? (start ?? null) : hooks.focused();
    } else if (event.kind === "announce") {
      el = regionSaying(root, event.text);
    }
    return el ? hooks.idFor(el) : undefined;
  };
  const recording = startTimeline(root, {
    onEvents: (events) => {
      const items = events.map((event, i) => {
        // The start's event is the first of the first run, if it came at
        // all: it did if the recorder named where focus was.
        const isStart =
          i === 0 && start !== undefined && event.kind === "focus";
        const nodeId = targetOf(event, isStart);
        return nodeId === undefined ? { event } : { event, nodeId };
      });
      start = undefined;
      if (items.length) hooks.send(items);
    },
  });
  // The root is the document's own element, so any element focus rests on
  // makes a start event; `<body>` and nothing make none.
  start = hooks.focused() ?? undefined;
  return recording;
}

/** What the live-region line sends for one announcement. */
export interface LiveRegionLine {
  text: string;
  level: "polite" | "assertive";
  role: string;
}

/**
 * The panel's live-region line, through the same recorder as the TIMELINE
 * view (ADR-0002's one live-region rule): announcements alone, each handed
 * to `send`. Null where the recorder can't start.
 */
export function recordLiveRegions(
  root: Element,
  send: (line: LiveRegionLine) => void,
): TimelineRecording | null {
  try {
    return startTimeline(root, {
      focus: false,
      onEvents: (events) => {
        for (const event of events) {
          if (event.kind !== "announce") continue;
          send({
            text: event.text,
            level: event.live,
            // The line has always named a region with no role of its own
            // (an `aria-live` <div>) a status.
            role: event.role === "generic" ? "status" : event.role,
          });
        }
      },
    });
  } catch {
    return null;
  }
}

/** The messages a {@link TimelineSession} sends the panel. */
export type TimelineMessage =
  | {
      type: "TIMELINE_EVENTS";
      payload: { session: string; items: TimelineItem[] };
    }
  | {
      type: "TIMELINE_ENDED";
      payload: { session: string; reason: TimelineEndReason };
    };

/**
 * The top frame's one TIMELINE recording, for the panel's `session`. A new
 * one stops the one before. Its runs are posted as they settle and kept
 * nowhere here.
 */
export class TimelineSession {
  private current: { session: string; recording: TimelineRecording } | null =
    null;

  constructor(
    private readonly hooks: Omit<TimelineHooks, "send"> & {
      post: (message: TimelineMessage) => void;
    },
  ) {}

  begin(
    session: string,
    root: Element,
  ): { success: true } | { success: false; error: string } {
    this.end();
    try {
      const recording = recordTimeline(root, {
        ...this.hooks,
        send: (items) =>
          this.hooks.post({
            type: "TIMELINE_EVENTS",
            payload: { session, items },
          }),
      });
      this.current = { session, recording };
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Stop the recording (`session`'s, when named), if there is one. `stop()`
   * posts the last block's events first. With `reason`, the panel is told
   * it ended on its own.
   */
  end(reason?: TimelineEndReason, session?: string): void {
    const current = this.current;
    if (!current || (session !== undefined && session !== current.session)) {
      return;
    }
    this.current = null;
    try {
      current.recording.stop();
    } finally {
      if (reason) {
        this.hooks.post({
          type: "TIMELINE_ENDED",
          payload: { session: current.session, reason },
        });
      }
    }
  }
}
