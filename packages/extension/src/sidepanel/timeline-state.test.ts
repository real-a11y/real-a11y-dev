import type { TimelineEvent } from "@real-a11y-dev/core";
import { serializeTimeline } from "@real-a11y-dev/serialize";
import { describe, expect, it } from "vitest";

import {
  initialTimeline,
  timelineLine,
  timelineReducer,
  timelineStatus,
  timelineText,
  type TimelineAction,
  type TimelineState,
} from "./timeline-state.js";

const focusOn = (name: string): TimelineEvent => ({
  kind: "focus",
  stop: {
    role: "button",
    name,
    description: "",
    states: {},
    properties: {},
    isExposedToAT: true,
  },
  hidden: false,
});
const nowhere: TimelineEvent = { kind: "focus", stop: null, hidden: false };
const said: TimelineEvent = {
  kind: "announce",
  role: "status",
  text: "Draft deleted.",
  live: "assertive",
};

function run(...actions: TimelineAction[]): TimelineState {
  return actions.reduce(timelineReducer, initialTimeline);
}

const recording = (session = "s1") =>
  [
    { type: "start", session },
    { type: "started", session },
  ] as const;

describe("the TIMELINE view's state", () => {
  it("writes each line as serializeTimeline does, and copies its lines exactly", () => {
    const events = [focusOn("Delete draft"), nowhere, said];
    const state = run(...recording(), {
      type: "events",
      session: "s1",
      items: events.map((event) => ({ event })),
    });
    expect(state.lines.map((l) => l.text)).toEqual([
      'focus     button "Delete draft"',
      "focus     (none)",
      'announce  status "Draft deleted." {live=assertive}',
    ]);
    expect(timelineText(state)).toBe(serializeTimeline(events));
  });

  it("copies (nothing recorded) for a recording with no lines, as recordTimeline does", () => {
    expect(timelineText(run(...recording()))).toBe("(nothing recorded)");
  });

  it("drops a run from any other recording", () => {
    const state = run(...recording("s2"), {
      type: "events",
      session: "s1",
      items: [{ event: said }],
    });
    expect(state.lines).toEqual([]);
  });

  it("keeps what the recorder settled as it stopped", () => {
    const state = run(
      ...recording(),
      { type: "stop" },
      {
        type: "events",
        session: "s1",
        items: [{ event: said }],
      },
    );
    expect(state.status).toBe("stopped");
    expect(state.lines).toHaveLength(1);
  });

  it("drops nothing it can read and shows nothing it can't", () => {
    const state = run(...recording(), {
      type: "events",
      session: "s1",
      items: [
        null,
        3,
        { event: null },
        { event: { text: "no kind" } },
        { event: said, nodeId: 4 },
      ],
    });
    expect(state.lines.map(({ text, nodeId }) => ({ text, nodeId }))).toEqual([
      {
        text: 'announce  status "Draft deleted." {live=assertive}',
        nodeId: undefined,
      },
    ]);
  });

  it("gives an event of a kind it doesn't know a line of its own", () => {
    // Core can record kinds (a click, say) before the panel knows them.
    const click = {
      kind: "click",
      target: "button",
    } as unknown as TimelineEvent;
    expect(timelineLine(click)).toMatch(/^click {5}/);
  });

  it("starts each recording afresh", () => {
    const state = run(
      ...recording("s1"),
      { type: "events", session: "s1", items: [{ event: said }] },
      { type: "stop" },
      ...recording("s2"),
    );
    expect(state.lines).toEqual([]);
    expect(state.session).toBe("s2");
  });

  it("says why it couldn't start", () => {
    const state = run(
      { type: "start", session: "s1" },
      { type: "failed", session: "s1", error: "Content script not available" },
    );
    expect(state.status).toBe("idle");
    expect(timelineStatus(state)).toBe(
      "Couldn't record this page: Content script not available",
    );
  });

  it("ends on a navigation, and no line highlights after", () => {
    const state = run(
      ...recording(),
      {
        type: "events",
        session: "s1",
        items: [{ event: said, nodeId: "sn-1" }],
      },
      { type: "ended", session: "s1", cause: "navigated" },
    );
    expect(state.status).toBe("stopped");
    expect(state.linked).toBe(false);
    expect(timelineStatus(state)).toBe(
      "Recording ended: the page navigated. 1 line.",
    );
  });

  it("ignores an end of an earlier recording", () => {
    const state = run(...recording("s2"), {
      type: "ended",
      session: "s1",
      cause: "document",
    });
    expect(state.status).toBe("recording");
  });

  it("clears the lines and keeps a recording running", () => {
    const state = run(
      ...recording(),
      { type: "events", session: "s1", items: [{ event: said }] },
      { type: "clear" },
      { type: "events", session: "s1", items: [{ event: nowhere }] },
    );
    expect(state.status).toBe("recording");
    expect(state.lines.map((l) => l.text)).toEqual(["focus     (none)"]);
  });

  it("forgets a stopped recording on Clear", () => {
    const state = run(
      ...recording(),
      { type: "stop" },
      { type: "clear" },
      {
        type: "events",
        session: "s1",
        items: [{ event: said }],
      },
    );
    expect(state).toEqual(initialTimeline);
  });
});
