/**
 * IIFE timeline-bundle entry, compiled to `dist/timeline-bundle.iife.global.js`
 * and set as `window.__realA11yTimeline__`.
 *
 * The timeline view's recorder (ADR-0002), packaged to be injected into a
 * page only while a timeline records. It is NOT in the page bundle: there it
 * would add about 3.9 kB gzipped to every audited page for a view most calls
 * never use. It carries its own copy of `core`, so a page that has both
 * bundles holds two copies of it, which `realmSingleton` allows.
 *
 * Node never calls this directly: `startPageTimeline` in `timeline.ts`
 * injects it, starts it on a root, and takes each run of events out through
 * a CDP binding as its block settles, so a navigation keeps what came
 * before.
 *
 * Every export is a **published surface**, as the page bundle's are: a
 * caller can evaluate the IIFE and call `__realA11yTimeline__.start` itself.
 * `timeline-bundle.test.ts` pins the list against its consumers.
 */

import {
  startTimeline,
  type TimelineEvent,
  type TimelineRecording,
} from "@real-a11y-dev/core";

/** How {@link start} records. Plain data, so it crosses `page.evaluate`. */
export interface InPageTimelineOptions {
  /** CSS selector for the root. `"body"` falls back to `document.body`. */
  selector: string;
  /** Names the recording, so {@link stop} and each payload can be told apart
   *  from another caller's. */
  token: string;
  /**
   * A global function, such as one `Runtime.addBinding` installs, to hand
   * each run of events to as `JSON.stringify({ token, events })`. Omitted,
   * events wait for {@link stop}.
   */
  binding?: string;
  focus?: boolean;
  announcements?: boolean;
  /** Strict mode (ADR-0001), for focus names. */
  redactInput?: boolean;
}

/** The one recording in this document, and the token that names it. */
let active: { token: string; recording: TimelineRecording } | undefined;

/**
 * The root `selector` names. Through `Document.prototype`, not `document`:
 * `Document` has [LegacyOverrideBuiltIns], so `<img name="querySelector">`
 * would be `document.querySelector` (as `BrowserSession.call` explains).
 */
function resolveRoot(selector: string): Element {
  const docProto = Document.prototype;
  let root: Element | null;
  try {
    root = docProto.querySelector.call(document, selector);
  } catch {
    throw new Error(`Invalid root selector: "${selector}".`);
  }
  if (root) return root;
  const body = Object.getOwnPropertyDescriptor(docProto, "body")?.get?.call(
    document,
  ) as HTMLElement | null | undefined;
  if (selector === "body" && body) return body;
  throw new Error(
    `root selector "${selector}" matched no element on the page.`,
  );
}

/**
 * Start recording on the root `options.selector` names. One recording per
 * document: starting a second throws until the first is stopped.
 */
export function start(options: InPageTimelineOptions): void {
  if (active) {
    throw new Error(
      "A timeline is already recording on this page. Stop it first.",
    );
  }
  const root = resolveRoot(options.selector);
  // Read once, now: a page that replaces or deletes the global later can't
  // take the events' way out from under a running recording.
  const send = options.binding
    ? ((globalThis as Record<string, unknown>)[options.binding] as
        ((payload: string) => void) | undefined)
    : undefined;
  if (options.binding && typeof send !== "function") {
    throw new Error(
      `The timeline's binding "${options.binding}" is not on the page.`,
    );
  }
  const { token } = options;
  const recording = startTimeline(root, {
    focus: options.focus,
    announcements: options.announcements,
    redactInput: options.redactInput,
    ...(send
      ? {
          onEvents: (events: readonly TimelineEvent[]) =>
            send(JSON.stringify({ token, events })),
        }
      : {}),
  });
  active = { token, recording };
}

/**
 * Stop the recording `token` names and return every event it recorded, or
 * `null` when this document holds no such recording: a navigation replaced
 * the document it started in, or it was stopped already.
 */
export function stop(token: string): readonly TimelineEvent[] | null {
  if (!active || active.token !== token) return null;
  const { recording } = active;
  active = undefined;
  return recording.stop();
}
