/**
 * Record the timeline view (ADR-0002) in a live Chromium page: focus moves
 * and live-region announcements, in the order the page made them.
 *
 * The recorder runs IN the page, the second DOM holdout after the tab order:
 * the order exists only there. It is a bundle of its own
 * (`timeline-bundle.ts`), injected only while a timeline records, never with
 * the page bundle. Each run of events leaves the page as its block settles,
 * through a CDP binding (`Runtime.addBinding`), so when a navigation replaces
 * the document, and the recorder with it, what came before is already out.
 *
 * One API for every CDP surface: the CLI's `timeline` command (through
 * `BrowserSession.startTimeline`), and the MCP tools and `testing`'s
 * Playwright adapter, which take a Playwright `Page` straight to
 * {@link startPageTimeline}.
 */

import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { TimelineEvent } from "@real-a11y-dev/core";

import type { CDPSession, Page } from "playwright";

import type { InPageTimelineOptions } from "./timeline-bundle.js";

/**
 * The injected timeline bundle, as SOURCE TEXT: lazily, and cached. Inlined
 * at build time like the page bundle (`pageBundleSource` explains why a path
 * won't do once this package is bundled into a consumer).
 */
declare const __REAL_A11Y_TIMELINE_BUNDLE__: string | undefined;

// The `define` appears twice, in the `typeof` guard and the assignment, and
// only one copy of the bundle survives: esbuild folds `typeof "<literal>"`
// to `"string"` and drops the guard. Restructure it so esbuild can't fold an
// occurrence, and the artifact carries the bundle twice.
let cachedSource: string | undefined;

export function timelineBundleSource(): string {
  if (cachedSource !== undefined) return cachedSource;
  if (typeof __REAL_A11Y_TIMELINE_BUNDLE__ === "string") {
    cachedSource = __REAL_A11Y_TIMELINE_BUNDLE__;
    return cachedSource;
  }
  // From SOURCE (vitest, `tsx`): no bundler applied the define.
  try {
    cachedSource = readFileSync(
      fileURLToPath(
        new URL("../dist/timeline-bundle.iife.global.js", import.meta.url),
      ),
      "utf8",
    );
  } catch {
    // Don't leak the absolute local path into tool output.
    throw new Error(
      "Real A11y timeline bundle is missing — run `pnpm build` in " +
        "@real-a11y-dev/browser (running from source requires the bundles " +
        "to have been built at least once).",
    );
  }
  return cachedSource;
}

/** The bundle as one expression that hoists its global onto `globalThis`,
 *  evaluated over CDP so the page's CSP and Trusted Types can't block it. */
function bundleExpression(): string {
  return `(function(){\n${timelineBundleSource()}\n;globalThis.__realA11yTimeline__=__realA11yTimeline__;})()`;
}

/** How {@link startPageTimeline} records. */
export interface PageTimelineOptions {
  /** CSS selector for the root; only what it holds is recorded. Default
   *  `"body"`. */
  root?: string;
  /** Record focus moves. Default `true`. */
  focus?: boolean;
  /** Record live-region announcements. Default `true`. */
  announcements?: boolean;
  /**
   * Strict mode (ADR-0001): a focused node's name that would carry what a
   * user typed reads `[redacted]` whole. Any truthy value turns it on.
   */
  redactInput?: boolean;
  /**
   * Called in Node with each run of events as it leaves the page, in order:
   * where focus starts, then each block as it settles. For a surface that
   * streams; the CLI needs only {@link PageTimeline.stop}. A throw is
   * swallowed, so it can't stop the recording.
   */
  onEvents?: (events: readonly TimelineEvent[]) => void;
  /**
   * Keep at most this many events in Node; past it,
   * {@link PageTimelineResult.truncated}. A busy `log` region can announce
   * without end. The page's recorder still holds every event until `stop()`.
   * A whole number, 0 or more. Default 10 000.
   */
  maxEvents?: number;
}

/** How a recording came to end. */
export type TimelineEnd =
  /** `stop()` ended it, on the document it started in. */
  | "stopped"
  /** A navigation replaced the document, and the recorder with it. */
  | "navigated"
  /** The page closed. */
  | "closed";

/** What {@link PageTimeline.stop} returns. */
export interface PageTimelineResult {
  /**
   * Every event, in order. The field-value gates ran in the page; a user's
   * `redact` patterns have NOT: `serializeTimeline` applies them to lines, and
   * a caller that hands events on applies them itself.
   */
  events: readonly TimelineEvent[];
  end: TimelineEnd;
  /** With `end: "navigated"`: where the page went, as far as Playwright
   *  knows when `stop()` runs. */
  url?: string;
  /** Events past `maxEvents` were dropped. */
  truncated: boolean;
}

/** A running recording, from {@link startPageTimeline}. */
export interface PageTimeline {
  /** The events out of the page so far. */
  events(): readonly TimelineEvent[];
  /** What ended it already, or `null` while it records. */
  ended(): Exclude<TimelineEnd, "stopped"> | null;
  /**
   * Stop recording and return every event. On the document it started in,
   * the page's own list, which also holds a block that hadn't settled yet;
   * after a navigation, what was streamed before it. Later calls return the
   * same result.
   */
  stop(): Promise<PageTimelineResult>;
}

/** The global the recorder sends its runs through: random per recording, so
 *  a page can't count on its name. */
function bindingName(): string {
  return `__realA11yTimeline_${randomBytes(8).toString("hex")}`;
}

const DEFAULT_MAX_EVENTS = 10_000;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

type FocusStop = NonNullable<Extract<TimelineEvent, { kind: "focus" }>["stop"]>;

function asAnnounce(value: Record<string, unknown>): TimelineEvent | null {
  const { role, text, live } = value;
  if (typeof role !== "string" || typeof text !== "string") return null;
  if (live !== "polite" && live !== "assertive") return null;
  return { kind: "announce", role, text, live };
}

function asStop(stop: unknown): FocusStop | null {
  if (
    !isRecord(stop) ||
    typeof stop.role !== "string" ||
    typeof stop.name !== "string" ||
    typeof stop.description !== "string" ||
    !isRecord(stop.states) ||
    !isRecord(stop.properties) ||
    typeof stop.isExposedToAT !== "boolean"
  ) {
    return null;
  }
  // Only the fields a stop has, with values of the types they take: what
  // the page sent is the page's to write. Never a `value`, whatever it sent:
  // the recorder strips it, and a focus line has no place for one.
  return {
    role: stop.role,
    name: stop.name,
    description: stop.description,
    ...(stop.choiceWithheld === true ? { choiceWithheld: true as const } : {}),
    states: entriesOf(
      stop.states,
      (v): v is string | boolean =>
        typeof v === "string" || typeof v === "boolean",
    ),
    properties: entriesOf(
      stop.properties,
      (v): v is string => typeof v === "string",
    ),
    isExposedToAT: stop.isExposedToAT,
  };
}

/** The own entries of `record` whose values pass `keep`, in a fresh
 *  object. Not `__proto__`, which `JSON.parse` makes an own key and an
 *  assignment would turn into the object's prototype. */
function entriesOf<V>(
  record: Record<string, unknown>,
  keep: (value: unknown) => value is V,
): Record<string, V> {
  const out: Record<string, V> = {};
  for (const [key, value] of Object.entries(record)) {
    if (key !== "__proto__" && keep(value)) out[key] = value;
  }
  return out;
}

function asFocus(value: Record<string, unknown>): TimelineEvent | null {
  if (typeof value.hidden !== "boolean") return null;
  if (value.stop === null) {
    return { kind: "focus", stop: null, hidden: value.hidden };
  }
  const stop = asStop(value.stop);
  return stop ? { kind: "focus", stop, hidden: value.hidden } : null;
}

/**
 * `value` if it has the shape of a timeline event, else `null`. What leaves
 * the page is the page's to write, so nothing is trusted into Node that a
 * serializer would trip on.
 */
export function asTimelineEvent(value: unknown): TimelineEvent | null {
  if (!isRecord(value)) return null;
  if (value.kind === "announce") return asAnnounce(value);
  if (value.kind === "focus") return asFocus(value);
  return null;
}

/** The events of `raw` that are events, in order. */
function eventsIn(raw: readonly unknown[]): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  for (const item of raw) {
    const event = asTimelineEvent(item);
    if (event) events.push(event);
  }
  return events;
}

/** The events of one binding payload for `token`, or `null` for another's. */
function eventsOf(payload: string, token: string): TimelineEvent[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed.token !== token) return null;
  return Array.isArray(parsed.events) ? eventsIn(parsed.events) : null;
}

/** An error from a page whose document went away under the call. */
function isContextGone(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /Execution context was destroyed|Target (page, context or browser )?(has been )?closed|navigat/i.test(
    message,
  );
}

/** Start the injected recorder in the page; throws what the page threw. */
async function startInPage(
  page: Page,
  start: InPageTimelineOptions,
): Promise<void> {
  // A function, not just an object: a page's `<form name="__realA11yTimeline__">`
  // is an object on `window` too. Re-evaluating an injected bundle would
  // orphan a recording it holds, so it is injected only when it isn't there.
  const present = await page.evaluate(
    () =>
      typeof (
        (globalThis as Record<string, unknown>).__realA11yTimeline__ as
          { start?: unknown } | undefined
      )?.start === "function",
  );
  if (!present) await page.evaluate(bundleExpression());
  await page.evaluate((opts) => {
    const api = (globalThis as Record<string, unknown>).__realA11yTimeline__ as
      { start?: (o: unknown) => void } | undefined;
    if (!api || typeof api.start !== "function") {
      throw new Error(
        "The Real A11y timeline bundle did not initialize on this page.",
      );
    }
    api.start(opts);
  }, start);
}

/** Stop the recording `token` names in the page: its events, or `null`
 *  when the page's document holds no such recording. */
function stopInPage(
  page: Page,
  token: string,
  binding: string,
): Promise<unknown> {
  return page.evaluate(
    ({ token, binding }) => {
      const g = globalThis as Record<string, unknown>;
      const api = g.__realA11yTimeline__ as
        { stop?: (t: string) => unknown } | undefined;
      delete g[binding];
      return api && typeof api.stop === "function" ? api.stop(token) : null;
    },
    { token, binding },
  );
}

/** One recording's Node side: the CDP session its runs arrive on, and what
 *  has arrived. */
class Recording {
  readonly token = randomBytes(16).toString("hex");
  readonly binding = bindingName();
  readonly streamed: TimelineEvent[] = [];
  truncated = false;
  ended: Exclude<TimelineEnd, "stopped"> | null = null;
  result: Promise<PageTimelineResult> | undefined;
  private readonly maxEvents: number;

  constructor(
    private readonly page: Page,
    private readonly client: CDPSession,
    private readonly options: PageTimelineOptions,
  ) {
    this.maxEvents = options.maxEvents ?? DEFAULT_MAX_EVENTS;
    client.on("Runtime.bindingCalled", this.onBinding);
    client.on("Runtime.executionContextsCleared", this.onCleared);
    page.on("close", this.onClose);
  }

  async start(): Promise<void> {
    // `bindingCalled` is reported only to a session with Runtime enabled.
    await this.client.send("Runtime.enable");
    await this.client.send("Runtime.addBinding", { name: this.binding });
    await startInPage(this.page, {
      selector: this.options.root ?? "body",
      token: this.token,
      binding: this.binding,
      focus: this.options.focus,
      announcements: this.options.announcements,
      redactInput: Boolean(this.options.redactInput),
    });
  }

  private readonly onBinding = (event: { name: string; payload: string }) => {
    if (this.ended || this.result || event.name !== this.binding) return;
    const events = eventsOf(event.payload, this.token);
    if (!events?.length) return;
    const kept = this.capped(events, this.streamed.length);
    for (const event of kept) this.streamed.push(event);
    if (!kept.length || !this.options.onEvents) return;
    try {
      this.options.onEvents(kept);
    } catch {
      // The caller's to handle; the recording goes on.
    }
  };

  /** Every context of the page is gone: the main frame committed a new
   *  document, and the recorder went with the old one. */
  private readonly onCleared = () => {
    if (!this.result) this.ended ??= "navigated";
  };

  private readonly onClose = () => {
    if (!this.result) this.ended ??= "closed";
  };

  /** `events`, cut to what fits after `held` events already kept. */
  private capped(events: readonly TimelineEvent[], held: number) {
    const room = Math.max(0, this.maxEvents - held);
    if (events.length > room) this.truncated = true;
    return events.slice(0, room);
  }

  async release(): Promise<void> {
    this.client.off("Runtime.bindingCalled", this.onBinding);
    this.client.off("Runtime.executionContextsCleared", this.onCleared);
    this.page.off("close", this.onClose);
    await this.client
      .send("Runtime.removeBinding", { name: this.binding })
      .catch(() => {});
    await this.client.detach().catch(() => {});
  }

  /**
   * The page's own list, if its document is the one the recording started
   * in, or how it ended. Asked even when a navigation was seen: the token
   * says which document holds the recorder, and asking stops it wherever it
   * is, so none is left listening, and deletes the binding's global.
   */
  private async fromPage(): Promise<
    { events: TimelineEvent[] } | { end: Exclude<TimelineEnd, "stopped"> }
  > {
    if (this.page.isClosed()) return { end: "closed" };
    try {
      const own = await stopInPage(this.page, this.token, this.binding);
      // No recording on this document: it was replaced, even if no event
      // said so before the stop.
      return Array.isArray(own)
        ? { events: this.capped(eventsIn(own), 0) }
        : { end: this.ended ?? "navigated" };
    } catch (err) {
      if (!isContextGone(err)) throw err;
      return { end: this.page.isClosed() ? "closed" : "navigated" };
    }
  }

  /** Hand `onEvents` what it hasn't had: the block `stop()` settled, which
   *  the page sent as the stream was closing. */
  private deliverTail(events: readonly TimelineEvent[]): void {
    const tail = events.slice(this.streamed.length);
    if (!tail.length || !this.options.onEvents) return;
    try {
      this.options.onEvents(tail);
    } catch {
      // As in `onBinding`: the caller's to handle.
    }
  }

  async finish(): Promise<PageTimelineResult> {
    let events: readonly TimelineEvent[] = this.streamed;
    let end: TimelineEnd;
    try {
      const read = await this.fromPage();
      if ("events" in read) {
        events = read.events;
        end = "stopped";
        this.deliverTail(events);
        // And `events()` reads what `stop()` returned, the tail included.
        // Not `splice(…, ...events)`: a spread passes each event as an
        // argument, and a recording with a raised `maxEvents` can pass the
        // engine's argument limit.
        this.streamed.length = 0;
        for (const event of events) this.streamed.push(event);
      } else {
        end = read.end;
      }
    } finally {
      await this.release();
    }
    return {
      events: [...events],
      end,
      ...(end === "navigated" ? { url: this.page.url() } : {}),
      truncated: this.truncated,
    };
  }

  /** After a failed start: stop whatever did start, and take the binding's
   *  global back off the page, as far as the page still answers. */
  async abandon(): Promise<void> {
    if (!this.page.isClosed()) {
      await stopInPage(this.page, this.token, this.binding).catch(() => {});
    }
    await this.release();
  }
}

/**
 * Inject the timeline recorder into `page`'s main frame and start it on
 * `options.root`. Each run of events leaves the page as its block settles,
 * so a navigation ends the recording without losing what came before it.
 *
 * Chromium only (it needs a CDP session). One recording per document: a
 * second start before `stop()` throws. Rejects, having cleaned up, if the
 * root matches nothing or the options record nothing.
 */
export async function startPageTimeline(
  page: Page,
  options: PageTimelineOptions = {},
): Promise<PageTimeline> {
  const { maxEvents } = options;
  if (
    maxEvents !== undefined &&
    !(Number.isSafeInteger(maxEvents) && maxEvents >= 0)
  ) {
    throw new TypeError(
      `startPageTimeline: maxEvents must be a whole number of events, 0 or more (received ${String(maxEvents)}).`,
    );
  }
  const client = await page.context().newCDPSession(page);
  const recording = new Recording(page, client, options);
  try {
    await recording.start();
  } catch (err) {
    await recording.abandon();
    throw err;
  }
  return {
    events: () => [...recording.streamed],
    ended: () => recording.ended,
    stop: () => (recording.result ??= recording.finish()),
  };
}
