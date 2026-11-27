import { afterEach, describe, expect, it } from "vitest";

import {
  startTimeline,
  timelineProblem,
  type TimelineEvent,
} from "../index.js";

// The recorder's events. What they record, and in what order, is pinned line
// by line in `testing`'s timeline suite through `serializeTimeline`; these
// pin the shape a caller outside the page reads, and the gates on it.

/** Let the page's microtasks and the observer's callback run. */
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function byId(id: string): HTMLElement {
  return document.getElementById(id)!;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("startTimeline", () => {
  it("records focus as the tab order's stop, and an announcement as its parts", async () => {
    document.body.innerHTML = `<main><button id="b" aria-expanded="false">Save</button><p role="status" id="s"></p></main>`;
    const recording = startTimeline(document.querySelector("main")!);
    byId("b").focus();
    byId("s").textContent = "Saved.";
    await tick();
    const events = recording.stop();
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      kind: "focus",
      hidden: false,
      stop: { role: "button", name: "Save", states: { expanded: false } },
    });
    expect(events[1]).toEqual({
      kind: "announce",
      role: "status",
      text: "Saved.",
      live: "polite",
    });
  });

  it("carries the region's own politeness, whatever its role implies", async () => {
    document.body.innerHTML = `<main><div aria-live="assertive" id="p"></div></main>`;
    const recording = startTimeline(document.querySelector("main")!);
    byId("p").textContent = "Offline.";
    await tick();
    expect(recording.stop()).toEqual([
      {
        kind: "announce",
        role: "generic",
        text: "Offline.",
        live: "assertive",
      },
    ]);
  });

  it("records focus resting on nothing as a stop of null", async () => {
    document.body.innerHTML = `<main><button id="b">Save</button></main>`;
    byId("b").focus();
    const recording = startTimeline(document.querySelector("main")!);
    byId("b").blur();
    await tick();
    expect(recording.stop().map((e) => e.kind === "focus" && e.stop)).toEqual([
      expect.objectContaining({ name: "Save" }),
      null,
    ]);
  });

  it("marks a stop assistive tech can't reach hidden, and names one the tree never walked by its role", () => {
    document.body.innerHTML = `<main><div aria-hidden="true"><button id="a">A</button></div><button id="h" hidden>H</button></main>`;
    const recording = startTimeline(document.querySelector("main")!);
    byId("a").focus();
    byId("h").focus();
    const events = recording.stop();
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      kind: "focus",
      hidden: true,
      stop: {
        role: "button",
        name: "",
        description: "",
        states: {},
        properties: {},
        isExposedToAT: false,
      },
    });
  });

  it("never carries a focused field's value, nor a sensitive field's chosen option", () => {
    // Which option of a card-expiry popup holds focus says which month is
    // chosen (ADR-0001).
    document.body.innerHTML = `<main>
      <label>Note <input id="note" value="call Sam back"></label>
      <input role="combobox" aria-label="Month" aria-expanded="true" aria-controls="lb" autocomplete="cc-exp-month">
      <ul role="listbox" id="lb" aria-label="Months">
        <li role="option" tabindex="-1">01</li>
        <li role="option" tabindex="0" id="chosen" aria-selected="true">03</li>
      </ul>
    </main>`;
    const main = document.querySelector("main")!;
    const recording = startTimeline(main);
    byId("note").focus();
    const note = recording.stop();
    expect(JSON.stringify(note)).not.toContain("call Sam back");
    expect(note[0]).toMatchObject({ stop: { role: "textbox", name: "Note" } });

    const chosen = startTimeline(main);
    byId("chosen").focus();
    const events = chosen.stop();
    expect(JSON.stringify(events)).not.toContain("03");
    expect(events.at(-1)).toMatchObject({
      stop: { role: "option", name: "[redacted]" },
    });
  });

  it("hands each run of events to onEvents as it settles, where focus starts first", async () => {
    document.body.innerHTML = `<main><button id="a">A</button><button id="b">B</button><p role="status" id="s"></p></main>`;
    byId("a").focus();
    const runs: (readonly TimelineEvent[])[] = [];
    const recording = startTimeline(document.querySelector("main")!, {
      onEvents: (events) => runs.push(events),
    });
    expect(runs).toHaveLength(1);
    byId("s").textContent = "Ready.";
    await tick();
    byId("b").focus();
    await tick();
    const events = recording.stop();
    expect(runs.map((run) => run.map((e) => e.kind))).toEqual([
      ["focus"],
      ["announce"],
      ["focus"],
    ]);
    expect(runs.flat()).toEqual(events);
  });

  it("returns the same events from a second stop, and records nothing after the first", async () => {
    document.body.innerHTML = `<main><p role="status" id="s"></p></main>`;
    const recording = startTimeline(document.querySelector("main")!);
    const events = recording.stop();
    byId("s").textContent = "Later.";
    await tick();
    expect(recording.stop()).toBe(events);
    expect(events).toEqual([]);
    expect(Object.isFrozen(events)).toBe(true);
  });

  it("throws, naming itself, on a root or options that can record nothing", () => {
    const detached = document.createElement("main");
    expect(() => startTimeline(detached)).toThrow(
      /^startTimeline: the root isn't in the document/,
    );
    expect(() =>
      startTimeline(document.body, { focus: false, announcements: false }),
    ).toThrow(/^startTimeline: .* records nothing/);
    expect(timelineProblem(null)).toBe("expected a DOM Element, received null");
    expect(timelineProblem(document.body)).toBeNull();
  });
});
