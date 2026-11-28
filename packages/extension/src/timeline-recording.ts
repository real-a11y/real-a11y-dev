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
  getExplicitRole,
  getImplicitRole,
  impliedLiveLevel,
  liveRegionLevel,
  pageText,
  startTimeline,
  type TimelineEvent,
  type TimelineRecording,
} from "@real-a11y-dev/core";

/** Why a recording ended without the panel stopping it: the document it
 *  read left (`navigated`) or was replaced under the script (`document`), or
 *  another recording of the page took its place (`replaced`).
 *
 * @internal Extension-only. Not a stability promise.
 */
export type TimelineEndReason = "navigated" | "document" | "replaced";

/** One event as the panel gets it: the event as core recorded it, and the
 *  node id its line highlights, when one was found.
 *
 * @internal Extension-only. Not a stability promise.
 */
export interface TimelineItem {
  event: TimelineEvent;
  nodeId?: string;
}

/** @internal Extension-only. Not a stability promise. */
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
const getAttribute = Element.prototype.getAttribute;
const activeElementOf = Object.getOwnPropertyDescriptor(
  Document.prototype,
  "activeElement",
)!.get!;
const bodyOf = Object.getOwnPropertyDescriptor(
  Document.prototype,
  "body",
)!.get!;
const rootOf = Object.getOwnPropertyDescriptor(
  Document.prototype,
  "documentElement",
)!.get!;
const shadowRootOf = Object.getOwnPropertyDescriptor(
  Element.prototype,
  "shadowRoot",
)!.get!;

/** One line of text, its white space collapsed, as the recorder writes an
 *  announce event's text. */
function oneLine(text: string): string {
  return text.replace(/[ \t\n\r\f]+/g, " ").trim();
}

/** Does `el` announce, as the recorder counts a region that does: core's
 *  rule (`regionLevel` in core's timeline-regions.ts, which core keeps
 *  private), an authored region or an `<output>` that is a status, and not
 *  one whose `aria-live` is off. */
function announces(el: Element): boolean {
  const live = getAttribute.call(el, "aria-live")?.trim().toLowerCase();
  if (live === "off") return false;
  if (liveRegionLevel(el) !== null) return true;
  return el.localName === "output" && getImplicitRole(el) === "status";
}

/** The live region under `root`, open shadow trees included, that shows
 *  exactly `text` now: the last such in document order, which is the
 *  innermost of nested ones.
 *
 * @internal Extension-only. Not a stability promise.
 */
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
        announces(el) &&
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
 *
 * @internal Extension-only. Not a stability promise.
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

/**
 * The role the live-region line names a region by: the one its author gave
 * it, and a status for one with none (an `aria-live` <p> or <div>), as the
 * line always has. A role that makes a live region (`status`, `alert`,
 * `log`…) is the author's, or an `<output>`'s, which is a status anyway: no
 * look-up. Any other role may be the element's own or an author's (a
 * `<section>` is a region either way), so only then is the region found, by
 * its text, and a region not found keeps the role the event gives it.
 */
function lineRole(
  root: Element,
  event: Extract<TimelineEvent, { kind: "announce" }>,
): string {
  if (impliedLiveLevel(event.role)) return event.role;
  const region = regionSaying(root, event.text);
  if (!region) return event.role === "generic" ? "status" : event.role;
  return getExplicitRole(region) ?? "status";
}

/**
 * What the live-region line sends for one announcement.
 *
 * @internal Extension-only. Not a stability promise.
 */
export interface LiveRegionLine {
  text: string;
  level: "polite" | "assertive";
  role: string;
}

/**
 * The panel's live-region line, through the same recorder as the TIMELINE
 * view (ADR-0002's one live-region rule): announcements alone, each handed
 * to `send`. Null where the recorder can't start.
 *
 * @internal Extension-only. Not a stability promise.
 */
export function recordLiveRegions(
  root: Element,
  send: (line: LiveRegionLine) => void,
): TimelineRecording | null {
  let current: TimelineRecording | null = null;
  let heard = 0;
  let renewing = false;
  // The recorder keeps every event it hands over, for `stop()` to return,
  // and the line runs for as long as the panel is open. So every so often it
  // gives way to a fresh one, on a later microtask, out of the call that
  // handed the run over. Nothing is lost between them: the old one's stop
  // settles what the page did since, and the new one starts from what the
  // regions say then, as their baseline, so nothing is said twice.
  const renew = () => {
    renewing = false;
    if (!current) return;
    stopQuietly(current);
    heard = 0;
    current = start();
  };
  const start = (): TimelineRecording | null => {
    try {
      return startTimeline(root, {
        focus: false,
        onEvents: (events) => {
          for (const event of events) {
            if (event.kind !== "announce") continue;
            send({
              text: event.text,
              level: event.live,
              role: lineRole(root, event),
            });
          }
          heard += events.length;
          if (heard >= LIVE_LINE_RENEW_EVERY && !renewing) {
            renewing = true;
            void Promise.resolve().then(renew);
          }
        },
      });
    } catch {
      return null;
    }
  };
  current = start();
  if (!current) return null;
  return {
    stop: () => {
      const recording = current;
      current = null;
      return recording ? recording.stop() : [];
    },
  };
}

/** How many announcements one live-region line recorder hands over before
 *  a fresh one takes its place (`recordLiveRegions`).
 *
 * @internal Extension-only. Not a stability promise.
 */
export const LIVE_LINE_RENEW_EVERY = 100;

/**
 * The element focus rests on, through open shadow roots only, as core's
 * recorder reads it (`resolveFocusedElement`): a focus line names that
 * element, so its node is that one, not a control inside a closed shadow
 * root the line doesn't name. Null on `<body>`, `<html>` or nothing.
 * Clobber-safe: a named `<img>` or `<form>` called `activeElement` shadows
 * the document's own.
 *
 * @internal The TIMELINE view's. Not a stability promise.
 */
export function focusedForTimeline(doc: Document): Element | null {
  let el: unknown = activeElementOf.call(doc);
  if (!(el instanceof Element)) return null;
  if (el === bodyOf.call(doc) || el === rootOf.call(doc)) return null;
  for (let depth = 0; depth < 32; depth++) {
    const inner = (shadowRootOf.call(el) as ShadowRoot | null)?.activeElement;
    if (!inner || inner === el) break;
    el = inner;
  }
  return el as Element;
}

/**
 * The messages a {@link TimelineSession} sends the panel.
 *
 * @internal Extension-only. Not a stability promise.
 */
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
 *
 * @internal Extension-only. Not a stability promise.
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
    // The panel that started the one before is told, rather than left
    // waiting on lines that will never come.
    this.end("replaced");
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
    stopQuietly(current.recording);
    if (!reason) return;
    try {
      this.hooks.post({
        type: "TIMELINE_ENDED",
        payload: { session: current.session, reason },
      });
    } catch {
      // Nobody to tell: the extension is gone.
    }
  }
}

/**
 * Stop `recording`, whatever its last `onEvents` call throws: `stop()`
 * rethrows it once every run is out, and the callers end a recording midway
 * through work of their own (a rebind, a teardown), which must go on.
 *
 * @internal Extension-only. Not a stability promise.
 */
export function stopQuietly(recording: TimelineRecording | null): void {
  try {
    recording?.stop();
  } catch {
    // The run that threw was the panel's to show; the page is unaffected.
  }
}
