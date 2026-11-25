import { afterEach, describe, expect, it } from "vitest";

import { a11ySnapshotSerializer } from "./snapshot-box.js";

import { a11yDiff, capture, recordTimeline } from "./index.js";

expect.addSnapshotSerializer(a11ySnapshotSerializer);

/** Let the page's microtasks and the observer's callback run, as an `await`
 *  between two steps of a test does. */
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

/** A delete button that removes its own list item, with a status message. */
function draftPage(): HTMLElement {
  document.body.innerHTML = `<main>
    <p role="status" id="s"></p>
    <ul><li>Draft <button id="d">Delete draft</button></li></ul>
    <button id="n">New draft</button>
  </main>`;
  return document.querySelector("main")!;
}

/** The deletion: a status while it works, a removal, then the result. */
async function deleteDraft(): Promise<void> {
  byId("s").textContent = "Deleting…";
  await tick();
  byId("d").closest("li")!.remove(); // focus falls to <body>
  byId("s").textContent = "";
  await tick();
  byId("s").textContent = "Draft deleted.";
  byId("n").focus();
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("recordTimeline", () => {
  it("records what a diff of the two ends can't show", async () => {
    const main = draftPage();
    byId("d").focus();
    const before = capture(main);
    const timeline = recordTimeline(main);

    await deleteDraft();

    // The diff sees two moments...
    expect(a11yDiff(before, main, { childIds: false })).toMatchInlineSnapshot(`
      - button "Delete draft"
      - text "Draft"
      - listitem
      ~ status "Draft deleted.": a11y.name "" → "Draft deleted."
      ~ status "Draft deleted.": dom.textContent "" → "Draft deleted."
      focus: button "Delete draft" → button "New draft"
    `);
    // ...the timeline, everything between them, in order.
    expect(timeline.stop()).toMatchInlineSnapshot(`
      focus     button "Delete draft"
      announce  status "Deleting…"
      focus     (none)
      announce  status "Draft deleted."
      focus     button "New draft"
    `);
  });

  it("puts an announcement made after a focus move after it", async () => {
    const main = draftPage();
    const timeline = recordTimeline(main);
    byId("n").focus();
    byId("s").textContent = "Ready.";
    await tick();
    expect(timeline.stop()).toMatchInlineSnapshot(`
      focus     button "New draft"
      announce  status "Ready."
    `);
  });

  it("prints no line for focus that starts on nothing", () => {
    const main = draftPage();
    expect(recordTimeline(main).stop()).toMatchInlineSnapshot(
      `(nothing recorded)`,
    );
  });

  it("records a move between two elements as one line", () => {
    const main = draftPage();
    const timeline = recordTimeline(main);
    byId("d").focus();
    byId("n").focus();
    expect(timeline.stop()).toMatchInlineSnapshot(`
      focus     button "Delete draft"
      focus     button "New draft"
    `);
  });

  it("records a blur as focus resting on nothing", async () => {
    const main = draftPage();
    byId("d").focus();
    const timeline = recordTimeline(main);
    byId("d").blur();
    byId("s").textContent = "Closed.";
    await tick();
    expect(timeline.stop()).toMatchInlineSnapshot(`
      focus     button "Delete draft"
      focus     (none)
      announce  status "Closed."
    `);
  });

  it("orders a removal and an announcement in one block as the page made them", async () => {
    const main = draftPage();
    byId("d").focus();
    const timeline = recordTimeline(main);
    byId("s").textContent = "Deleting…";
    byId("d").closest("li")!.remove();
    await tick();
    expect(timeline.stop()).toMatchInlineSnapshot(`
      focus     button "Delete draft"
      announce  status "Deleting…"
      focus     (none)
    `);
  });

  it("reads where focus went when stopped before the page's next task", () => {
    const main = draftPage();
    byId("d").focus();
    const timeline = recordTimeline(main);
    byId("d").closest("li")!.remove();
    byId("s").textContent = "Deleted.";
    expect(timeline.stop()).toMatchInlineSnapshot(`
      focus     button "Delete draft"
      focus     (none)
      announce  status "Deleted."
    `);
  });

  it("names focus outside the root (none)", () => {
    document.body.innerHTML = `<main><button id="a">In</button></main><button id="b">Out</button>`;
    const timeline = recordTimeline(document.querySelector("main")!);
    byId("a").focus();
    byId("b").focus();
    expect(timeline.stop()).toMatchInlineSnapshot(`
      focus     button "In"
      focus     (none)
    `);
  });

  it("prints a focused node's states, as a tab stop does", () => {
    document.body.innerHTML = `<main>
      <label for="day">Day</label><input id="day" required aria-invalid="true">
      <button id="m" aria-expanded="false">Menu</button>
    </main>`;
    const timeline = recordTimeline(document.querySelector("main")!);
    byId("day").focus();
    byId("m").focus();
    expect(timeline.stop()).toMatchInlineSnapshot(`
      focus     textbox "Day" {required, invalid}
      focus     button "Menu" {expanded=false}
    `);
  });

  it("names a focused node the a11y view folds away", () => {
    document.body.innerHTML = `<main><div id="c" tabindex="-1"><p>Results</p></div></main>`;
    const timeline = recordTimeline(document.querySelector("main")!);
    byId("c").focus();
    expect(timeline.stop()).toMatchInlineSnapshot(`focus     generic`);
  });

  it("follows focus into a shadow root", () => {
    document.body.innerHTML = `<main><div id="host"></div></main>`;
    const shadow = byId("host").attachShadow({ mode: "open" });
    shadow.innerHTML = `<button>Inside</button>`;
    const timeline = recordTimeline(document.querySelector("main")!);
    shadow.querySelector("button")!.focus();
    expect(timeline.stop()).toMatchInlineSnapshot(`focus     button "Inside"`);
  });

  it("records nothing for a focus that stays put", () => {
    const main = draftPage();
    byId("d").focus();
    const timeline = recordTimeline(main);
    byId("d").textContent = "Remove draft";
    byId("d").focus();
    expect(timeline.stop()).toMatchInlineSnapshot(
      `focus     button "Delete draft"`,
    );
  });
});

describe("recordTimeline announcements", () => {
  it("coalesces text set and cleared within one synchronous block", async () => {
    const main = draftPage();
    const timeline = recordTimeline(main);
    byId("s").textContent = "Saving…";
    byId("s").textContent = "";
    await tick();
    expect(timeline.stop()).toMatchInlineSnapshot(`(nothing recorded)`);
  });

  it("announces the same text again only once the region has emptied", async () => {
    const main = draftPage();
    const timeline = recordTimeline(main);
    byId("s").textContent = "Saved.";
    await tick();
    byId("s").textContent = "Saved.";
    await tick();
    byId("s").textContent = "";
    await tick();
    byId("s").textContent = "Saved.";
    await tick();
    expect(timeline.stop()).toMatchInlineSnapshot(`
      announce  status "Saved."
      announce  status "Saved."
    `);
  });

  it("treats the text a region holds at the start as already said", async () => {
    document.body.innerHTML = `<main><p role="status" id="s">3 results</p></main>`;
    const timeline = recordTimeline(document.querySelector("main")!);
    byId("s").textContent = "3 results";
    await tick();
    byId("s").textContent = "4 results";
    await tick();
    expect(timeline.stop()).toMatchInlineSnapshot(
      `announce  status "4 results"`,
    );
  });

  it("names the region's role, and a politeness its role doesn't imply", async () => {
    document.body.innerHTML = `<main>
      <div role="alert" id="a"></div>
      <div aria-live="polite" id="p"></div>
      <div role="status" aria-live="assertive" id="sa"></div>
      <div role="log" id="l"></div>
    </main>`;
    const timeline = recordTimeline(document.querySelector("main")!);
    byId("a").textContent = "Card declined.";
    byId("p").textContent = "Saved.";
    byId("sa").textContent = "Offline.";
    byId("l").textContent = "Sam joined.";
    await tick();
    expect(timeline.stop()).toMatchInlineSnapshot(`
      announce  alert "Card declined."
      announce  generic "Saved." {live=polite}
      announce  status "Offline." {live=assertive}
      announce  log "Sam joined."
    `);
  });

  it("ignores regions switched off and plain elements", async () => {
    document.body.innerHTML = `<main>
      <div role="status" aria-live="off" id="o"></div>
      <p id="p"></p>
    </main>`;
    const timeline = recordTimeline(document.querySelector("main")!);
    byId("o").textContent = "Quiet.";
    byId("p").textContent = "Plain.";
    await tick();
    expect(timeline.stop()).toMatchInlineSnapshot(`(nothing recorded)`);
  });

  it("reads the whole region's text when part of it changes, on one line", async () => {
    document.body.innerHTML = `<main><div role="status" id="s">
      <span id="count">3</span>
      <span>results</span>
    </div></main>`;
    const timeline = recordTimeline(document.querySelector("main")!);
    byId("count").textContent = "4";
    await tick();
    expect(timeline.stop()).toMatchInlineSnapshot(
      `announce  status "4 results"`,
    );
  });

  it("keeps blocks apart, as a screen reader reads them", async () => {
    document.body.innerHTML = `<main><div role="status" id="s"></div></main>`;
    const timeline = recordTimeline(document.querySelector("main")!);
    byId("s").innerHTML = `<p>Saved.</p><p>3 items<br>synced</p>`;
    await tick();
    expect(timeline.stop()).toMatchInlineSnapshot(
      `announce  status "Saved. 3 items synced"`,
    );
  });

  it("leaves out what a screen reader can't reach in a region", async () => {
    document.body.innerHTML = `<main><div role="status" id="s"></div></main>`;
    const timeline = recordTimeline(document.querySelector("main")!);
    byId("s").innerHTML =
      `Saved <span aria-hidden="true">✓</span><span hidden>secret</span><textarea>draft text</textarea>`;
    await tick();
    expect(timeline.stop()).toMatchInlineSnapshot(`announce  status "Saved"`);
  });

  it("announces a region inserted with its text", async () => {
    document.body.innerHTML = `<main></main>`;
    const main = document.querySelector("main")!;
    const timeline = recordTimeline(main);
    main.insertAdjacentHTML(
      "beforeend",
      `<div><p role="alert">Session expired.</p></div>`,
    );
    await tick();
    expect(timeline.stop()).toMatchInlineSnapshot(
      `announce  alert "Session expired."`,
    );
  });

  it("announces a region revealed with its text, and forgets it once hidden", async () => {
    document.body.innerHTML = `<main><p role="alert" id="e" hidden>Name is required.</p></main>`;
    const timeline = recordTimeline(document.querySelector("main")!);
    byId("e").hidden = false;
    await tick();
    byId("e").hidden = true;
    await tick();
    byId("e").hidden = false;
    await tick();
    expect(timeline.stop()).toMatchInlineSnapshot(`
      announce  alert "Name is required."
      announce  alert "Name is required."
    `);
  });

  it("records only regions the root holds", async () => {
    document.body.innerHTML = `<main><p role="status" id="in"></p></main><p role="status" id="out"></p>`;
    const timeline = recordTimeline(document.querySelector("main")!);
    byId("out").textContent = "Elsewhere.";
    byId("in").textContent = "Here.";
    await tick();
    expect(timeline.stop()).toMatchInlineSnapshot(`announce  status "Here."`);
  });

  it("redacts focused names and announced text", async () => {
    document.body.innerHTML = `<main>
      <p role="status" id="s"></p>
      <button id="b">Order 4471</button>
    </main>`;
    const timeline = recordTimeline(document.querySelector("main")!, {
      redact: [/\d{4}/],
    });
    byId("b").focus();
    byId("s").textContent = "Order 4471 placed, 4471 confirmed.";
    await tick();
    expect(timeline.stop()).toMatchInlineSnapshot(`
      focus     button "Order [REDACTED]"
      announce  status "Order [REDACTED] placed, [REDACTED] confirmed."
    `);
  });
});

describe("recordTimeline options", () => {
  it("records focus alone with { announcements: false }", async () => {
    const main = draftPage();
    byId("d").focus();
    const timeline = recordTimeline(main, { announcements: false });
    await deleteDraft();
    expect(timeline.stop()).toMatchInlineSnapshot(`
      focus     button "Delete draft"
      focus     (none)
      focus     button "New draft"
    `);
  });

  it("records announcements alone with { focus: false }", async () => {
    const main = draftPage();
    byId("d").focus();
    const timeline = recordTimeline(main, { focus: false });
    await deleteDraft();
    expect(timeline.stop()).toMatchInlineSnapshot(`
      announce  status "Deleting…"
      announce  status "Draft deleted."
    `);
  });

  it("throws when told to record nothing", () => {
    const main = draftPage();
    expect(() =>
      recordTimeline(main, { focus: false, announcements: false }),
    ).toThrow(/records nothing/);
  });

  it("throws on a root that isn't an element", () => {
    expect(() => recordTimeline(null as unknown as Element)).toThrow(
      /expected a DOM Element, received null/,
    );
  });

  it("stops listening once stopped, and returns the same box again", async () => {
    const main = draftPage();
    const timeline = recordTimeline(main);
    byId("d").focus();
    const box = timeline.stop();
    byId("n").focus();
    byId("s").textContent = "Later.";
    await tick();
    expect(timeline.stop()).toBe(box);
    expect(box).toMatchInlineSnapshot(`focus     button "Delete draft"`);
  });
});
