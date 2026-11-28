/**
 * The TIMELINE view's state: one recording's lines, held in the panel's
 * memory and nowhere else (no `chrome.storage`, no log), and what the
 * recording is doing. Pure, so every transition is tested without a page.
 *
 * Each line is `serializeTimeline`'s for its event, and Copy is
 * `serializeTimeline` over every event, so a manual finding pastes straight
 * into a `recordTimeline` test.
 */

import type { TimelineEvent } from "@real-a11y-dev/core";
import { serializeTimeline } from "@real-a11y-dev/serialize";

import type { TimelineEndReason, TimelineItem } from "../timeline-recording.js";

/** Why a recording stopped without Stop: the page's own reasons
 *  (`TimelineEndReason`), or the panel moving to another tab. */
export type TimelineStopCause = TimelineEndReason | "tab";

export interface TimelineLine {
  /** Unique in the recording, for rendering. */
  id: number;
  event: TimelineEvent;
  /** What the line says. */
  text: string;
  /** The node clicking the line highlights on the page, when the content
   *  script found it. */
  nodeId?: string;
}

export interface TimelineState {
  /** `starting` while the page has yet to answer Record. */
  status: "idle" | "starting" | "recording" | "stopped";
  /** The recording lines are taken for; null once cleared or never started.
   *  A run for any other session is an earlier recording's, and dropped. */
  session: string | null;
  lines: TimelineLine[];
  /** Why it stopped without Stop, or why it couldn't start. */
  note?: string;
  /** The lines' nodes are still on the page the recording read, so a click
   *  can highlight them. False once that page is gone. */
  linked: boolean;
}

export const initialTimeline: TimelineState = {
  status: "idle",
  session: null,
  lines: [],
  linked: false,
};

export type TimelineAction =
  | { type: "start"; session: string }
  | { type: "started"; session: string }
  | { type: "failed"; session: string; error?: string }
  | { type: "events"; session: string; items: readonly unknown[] }
  | { type: "stop" }
  | { type: "ended"; session?: string; cause: TimelineStopCause }
  | { type: "clear" };

const KNOWN_KINDS = new Set(["focus", "announce"]);

/**
 * One event's line, as `serializeTimeline` writes it. An event of a kind
 * this panel doesn't know (core can add kinds before the panel catches up)
 * still gets a line: `serializeTimeline`'s, when it writes one for that
 * kind, or the kind on its own, rather than a line that misreads it.
 */
export function timelineLine(event: TimelineEvent): string {
  const kind = String((event as { kind: unknown }).kind);
  if (KNOWN_KINDS.has(kind)) return serializeTimeline([event]);
  try {
    const line = serializeTimeline([event]);
    if (line.startsWith(kind)) return line;
  } catch {
    // An older line format, which can't write this kind.
  }
  return `${kind.padEnd(10)}(not shown in this version)`;
}

/** Copy's text: exactly `serializeTimeline`'s lines for the recording. */
export function timelineText(state: TimelineState): string {
  return serializeTimeline(state.lines.map((line) => line.event));
}

/** A run's items the panel can read: an event with a kind, and a node id
 *  only when it is a string. Anything else is dropped, not shown. */
function readItems(items: readonly unknown[]): TimelineItem[] {
  const read: TimelineItem[] = [];
  for (const item of items) {
    if (typeof item !== "object" || item === null) continue;
    const { event, nodeId } = item as { event?: unknown; nodeId?: unknown };
    if (
      typeof event !== "object" ||
      event === null ||
      typeof (event as { kind?: unknown }).kind !== "string"
    ) {
      continue;
    }
    read.push({
      event: event as TimelineEvent,
      ...(typeof nodeId === "string" ? { nodeId } : {}),
    });
  }
  return read;
}

const CAUSES: Record<TimelineStopCause, string> = {
  navigated: "Recording ended: the page navigated.",
  document: "Recording ended: the page replaced its document.",
  replaced: "Recording ended: another side panel started recording this page.",
  tab: "Recording ended: the panel moved to another tab.",
};

/** Is the recording running, or about to? */
export function isRecording(state: TimelineState): boolean {
  return state.status === "recording" || state.status === "starting";
}

/** Is `session` the recording's, still answering Record? */
const awaiting = (state: TimelineState, session: string) =>
  session === state.session && state.status === "starting";

/** A run's lines added. Accepted after Stop as well: what the recorder
 *  settled as it stopped is on its way behind the answer. */
function addRun(
  state: TimelineState,
  { session, items }: Extract<TimelineAction, { type: "events" }>,
): TimelineState {
  if (session !== state.session || state.status === "idle") return state;
  const read = readItems(items);
  if (!read.length) return state;
  let id = state.lines.at(-1)?.id ?? 0;
  const lines = read.map(({ event, nodeId }) => ({
    id: ++id,
    event,
    text: timelineLine(event),
    ...(nodeId !== undefined ? { nodeId } : {}),
  }));
  return { ...state, lines: [...state.lines, ...lines] };
}

/** The page the lines' nodes were on is gone: no line highlights now, and a
 *  recording still running has stopped. */
function endOf(
  state: TimelineState,
  { session, cause }: Extract<TimelineAction, { type: "ended" }>,
): TimelineState {
  if (session !== undefined && session !== state.session) return state;
  if (!isRecording(state)) return { ...state, linked: false };
  return { ...state, status: "stopped", linked: false, note: CAUSES[cause] };
}

const reducers: {
  [T in TimelineAction["type"]]: (
    state: TimelineState,
    action: Extract<TimelineAction, { type: T }>,
  ) => TimelineState;
} = {
  // Each recording is one timeline, as one `recordTimeline` call is.
  start: (_, { session }) => ({
    status: "starting",
    session,
    lines: [],
    linked: true,
  }),
  started: (state, { session }) =>
    awaiting(state, session) ? { ...state, status: "recording" } : state,
  failed: (state, { session, error }) =>
    awaiting(state, session)
      ? {
          ...state,
          status: "idle",
          linked: false,
          note: `Couldn't record this page${error ? `: ${error}` : "."}`,
        }
      : state,
  events: addRun,
  stop: (state) =>
    isRecording(state) ? { ...state, status: "stopped" } : state,
  ended: endOf,
  // A recording still running keeps its session, and its next lines.
  clear: (state) =>
    isRecording(state)
      ? { ...state, lines: [], note: undefined }
      : { ...initialTimeline },
};

export function timelineReducer(
  state: TimelineState,
  action: TimelineAction,
): TimelineState {
  const reduce = reducers[action.type] as (
    state: TimelineState,
    action: TimelineAction,
  ) => TimelineState;
  return reduce(state, action);
}

/** The status line under the controls. */
export function timelineStatus(state: TimelineState): string {
  const count = state.lines.length;
  const lines = `${count} ${count === 1 ? "line" : "lines"}`;
  switch (state.status) {
    case "starting":
      return "Starting…";
    case "recording":
      // Not the count: this is a live region, and a count would be said
      // over the page on every line.
      return "Recording…";
    case "stopped":
      return state.note ? `${state.note} ${lines}.` : `Stopped — ${lines}.`;
    case "idle":
      return state.note ?? "Press Record, then use the page.";
  }
}
