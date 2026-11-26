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

  it("records a line for each move made in its own task", async () => {
    const main = draftPage();
    const timeline = recordTimeline(main);
    byId("d").focus();
    await tick();
    byId("n").focus();
    expect(timeline.stop()).toMatchInlineSnapshot(`
      focus     button "Delete draft"
      focus     button "New draft"
    `);
  });

  it("records only where focus lands when it passes through within one block", () => {
    const main = draftPage();
    const timeline = recordTimeline(main);
    byId("d").focus();
    byId("n").focus();
    expect(timeline.stop()).toMatchInlineSnapshot(
      `focus     button "New draft"`,
    );
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

  it("names focus outside the root (none) even while an overlay is showing", async () => {
    // A filled status outside the root is what makes a tree extraction widen
    // to <body>; what counts as inside the root mustn't hang on it.
    document.body.innerHTML = `<main><button id="a">In</button></main>
      <div role="status">Saved</div><button id="b">Out</button>`;
    const timeline = recordTimeline(document.querySelector("main")!);
    byId("a").focus();
    await tick();
    byId("b").focus();
    expect(timeline.stop()).toMatchInlineSnapshot(`
      focus     button "In"
      focus     (none)
    `);
  });

  it("orders a drop from a removed shadow host as the page made it", async () => {
    document.body.innerHTML = `<main>
      <p role="status" id="s"></p><div id="wrap"><div id="host"></div></div>
    </main>`;
    const shadow = byId("host").attachShadow({ mode: "open" });
    shadow.innerHTML = `<button>Inside</button>`;
    shadow.querySelector("button")!.focus();
    const timeline = recordTimeline(document.querySelector("main")!);
    byId("wrap").remove();
    byId("s").textContent = "Removed.";
    await tick();
    expect(timeline.stop()).toMatchInlineSnapshot(`
      focus     button "Inside"
      focus     (none)
      announce  status "Removed."
    `);
  });

  it("keeps a removal, an announcement and a focus move in one block in their order", async () => {
    const main = draftPage();
    byId("d").focus();
    const timeline = recordTimeline(main);
    byId("d").closest("li")!.remove();
    byId("s").textContent = "Deleted.";
    byId("n").focus();
    await tick();
    expect(timeline.stop()).toMatchInlineSnapshot(`
      focus     button "Delete draft"
      announce  status "Deleted."
      focus     button "New draft"
    `);
  });

  it("marks focus inside aria-hidden content above the root", () => {
    document.body.innerHTML = `<div aria-hidden="true"><main><button id="a">A</button></main></div>`;
    const timeline = recordTimeline(document.querySelector("main")!);
    byId("a").focus();
    expect(timeline.stop()).toMatchInlineSnapshot(
      `focus     button "A" [hidden]`,
    );
  });

  it("marks focus on an element the tree doesn't reach, rather than (none)", async () => {
    document.body.innerHTML = `<main><button id="v">Visible</button><div hidden><button id="h">Hidden</button></div></main>`;
    const timeline = recordTimeline(document.querySelector("main")!);
    byId("v").focus();
    await tick();
    byId("h").focus();
    expect(timeline.stop()).toMatchInlineSnapshot(`
      focus     button "Visible"
      focus     button [hidden]
    `);
  });

  it("marks focus that lands where assistive tech can't reach", () => {
    document.body.innerHTML = `<main><div aria-hidden="true"><button id="h">Hidden</button></div></main>`;
    const timeline = recordTimeline(document.querySelector("main")!);
    byId("h").focus();
    expect(timeline.stop()).toMatchInlineSnapshot(
      `focus     button "Hidden" [hidden]`,
    );
  });

  it("names focus outside the root (none)", async () => {
    document.body.innerHTML = `<main><button id="a">In</button></main><button id="b">Out</button>`;
    const timeline = recordTimeline(document.querySelector("main")!);
    byId("a").focus();
    await tick();
    byId("b").focus();
    expect(timeline.stop()).toMatchInlineSnapshot(`
      focus     button "In"
      focus     (none)
    `);
  });

  it("prints a focused node's states, as a tab stop does", async () => {
    document.body.innerHTML = `<main>
      <label for="day">Day</label><input id="day" required aria-invalid="true">
      <button id="m" aria-expanded="false">Menu</button>
    </main>`;
    const timeline = recordTimeline(document.querySelector("main")!);
    byId("day").focus();
    await tick();
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

  it("follows focus between controls inside one shadow root", async () => {
    // A move within one shadow root stops at its host: the document hears
    // nothing, so the recorder listens in the shadow root too.
    document.body.innerHTML = `<main><div id="host"></div></main>`;
    const shadow = byId("host").attachShadow({ mode: "open" });
    shadow.innerHTML = `<button>First</button><button>Second</button><button>Third</button>`;
    const [first, second, third] = shadow.querySelectorAll("button");
    first!.focus();
    const timeline = recordTimeline(document.querySelector("main")!);
    second!.focus();
    await tick();
    third!.focus();
    expect(timeline.stop()).toMatchInlineSnapshot(`
      focus     button "First"
      focus     button "Second"
      focus     button "Third"
    `);
  });

  it("withholds a sensitive field's focused choice, as the tab order does", () => {
    // Which option of a card-expiry popup holds focus says which month is
    // chosen (ADR-0001), so its name never reaches the line.
    document.body.innerHTML = `<main>
      <input role="combobox" aria-label="Month" aria-expanded="true" aria-controls="lb" autocomplete="cc-exp-month">
      <ul role="listbox" id="lb" aria-label="Months">
        <li role="option" tabindex="-1">01</li>
        <li role="option" tabindex="0" id="chosen" aria-selected="true">03</li>
      </ul>
    </main>`;
    const timeline = recordTimeline(document.querySelector("main")!);
    byId("chosen").focus();
    const text = timeline.stop().text;
    expect(text).not.toContain("03");
    expect(text).toBe(`focus     option "[redacted]"`);
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

  it("reads text a focus move interrupts only as the block left it", async () => {
    const main = draftPage();
    const timeline = recordTimeline(main);
    byId("s").textContent = "Saving…";
    byId("n").focus();
    byId("s").textContent = "";
    await tick();
    expect(timeline.stop()).toMatchInlineSnapshot(
      `focus     button "New draft"`,
    );
  });

  it("announces a region put back with the text it had when removed", async () => {
    document.body.innerHTML = `<main><p role="alert" id="a">Session expired.</p></main>`;
    const main = document.querySelector("main")!;
    const alert = byId("a");
    alert.remove();
    const timeline = recordTimeline(main);
    main.append(alert);
    await tick();
    alert.remove();
    await tick();
    main.append(alert);
    await tick();
    expect(timeline.stop()).toMatchInlineSnapshot(`
      announce  alert "Session expired."
      announce  alert "Session expired."
    `);
  });

  it("hears an <output>, a status by its tag", async () => {
    document.body.innerHTML = `<main><output id="o"></output></main>`;
    const timeline = recordTimeline(document.querySelector("main")!);
    byId("o").textContent = "42";
    await tick();
    expect(timeline.stop()).toMatchInlineSnapshot(`announce  status "42"`);
  });

  it("stays silent for a change under aria-live=off inside a region", async () => {
    document.body.innerHTML = `<main><div role="status">Total: <span aria-live="off" id="c">1</span></div></main>`;
    const timeline = recordTimeline(document.body);
    byId("c").textContent = "2";
    await tick();
    // Nor does a later restyle above it bring the silenced change up.
    document.body.className = "theme-dark";
    await tick();
    expect(timeline.stop()).toMatchInlineSnapshot(`(nothing recorded)`);
  });

  it("places text written after a focus move after it", async () => {
    const main = draftPage();
    const timeline = recordTimeline(main);
    byId("s").textContent = "Working";
    byId("n").focus();
    byId("s").textContent = "Done";
    await tick();
    expect(timeline.stop()).toMatchInlineSnapshot(`
      focus     button "New draft"
      announce  status "Done"
    `);
  });

  it("records text an await of a resolved promise separates, as documented", async () => {
    // A browser would render both writes together; the recorder reads at the
    // first microtask checkpoint, so it hears the first one.
    const main = draftPage();
    const timeline = recordTimeline(main);
    byId("s").textContent = "Saving…";
    await Promise.resolve();
    byId("s").textContent = "";
    await tick();
    expect(timeline.stop()).toMatchInlineSnapshot(`announce  status "Saving…"`);
  });

  it("doesn't announce a region moved within one block", async () => {
    const main = draftPage();
    byId("s").textContent = "Hi";
    const timeline = recordTimeline(main);
    main.append(byId("s"));
    await tick();
    expect(timeline.stop()).toMatchInlineSnapshot(`(nothing recorded)`);
  });

  it("doesn't announce a region again when aria-hidden above it comes off", async () => {
    // A modal hides the rest of the page this way, and shows it again.
    document.body.innerHTML = `<div id="app"><p role="status">3 results</p></div>`;
    const timeline = recordTimeline(document.body);
    byId("app").setAttribute("aria-hidden", "true");
    await tick();
    byId("app").removeAttribute("aria-hidden");
    await tick();
    expect(timeline.stop()).toMatchInlineSnapshot(`(nothing recorded)`);
  });

  it("doesn't replay a silent change made while hidden from above", async () => {
    document.body.innerHTML = `<div id="app"><p role="status" id="s">Total: <span aria-live="off" id="o">1</span></p></div>`;
    const timeline = recordTimeline(document.body);
    byId("app").setAttribute("aria-hidden", "true");
    await tick();
    byId("o").textContent = "2";
    await tick();
    byId("app").removeAttribute("aria-hidden");
    await tick();
    byId("s").append(" items");
    await tick();
    expect(timeline.stop()).toMatchInlineSnapshot(
      `announce  status "Total: 2 items"`,
    );
  });

  it("treats text a region hidden from above holds at the start as already said", async () => {
    document.body.innerHTML = `<div id="app" inert><p role="status">3 results</p></div>`;
    const timeline = recordTimeline(document.body);
    byId("app").removeAttribute("inert");
    await tick();
    expect(timeline.stop()).toMatchInlineSnapshot(`(nothing recorded)`);
  });

  it("still announces what a restyle reveals behind text hidden inside a region", async () => {
    document.body.innerHTML = `<style>.more { display: none } .open .more { display: inline }</style>
      <main id="m"><p role="status"><span aria-hidden="true">✓</span> <span class="more">Saved</span></p></main>`;
    const timeline = recordTimeline(byId("m"));
    byId("m").className = "open";
    await tick();
    expect(timeline.stop()).toMatchInlineSnapshot(`announce  status "Saved"`);
  });

  it("stays silent for a change under aria-live=off made with a restyle above it", async () => {
    document.body.innerHTML = `<main id="m"><p role="status">Total: <span aria-live="off" id="o">1</span></p></main>`;
    const timeline = recordTimeline(byId("m"));
    byId("m").className = "busy";
    byId("o").textContent = "2";
    await tick();
    expect(timeline.stop()).toMatchInlineSnapshot(`(nothing recorded)`);
  });

  it("places text a restyle reveals after a focus move made before it", async () => {
    document.body.innerHTML = `<style>.more { display: none } .open .more { display: inline }</style>
      <main id="m"><button id="b">Sync</button><p role="status">Saved <span class="more">3 files synced</span></p></main>`;
    const timeline = recordTimeline(byId("m"));
    byId("m").className = "busy";
    byId("b").focus();
    byId("m").className = "open";
    await tick();
    expect(timeline.stop()).toMatchInlineSnapshot(`
      focus     button "Sync"
      announce  status "Saved 3 files synced"
    `);
  });

  it("keeps a line before a focus move it came before, whatever changes after", async () => {
    document.body.innerHTML = `<style>.more { display: none } .open .more { display: inline }</style>
      <main id="m"><button id="a">Sync</button><button id="b">Close</button>
      <p role="status" id="s">Saved <span class="more">3 files synced</span></p></main>`;
    const timeline = recordTimeline(byId("m"));
    byId("m").className = "open";
    byId("a").focus();
    byId("m").style.backgroundColor = "white";
    await tick();
    byId("s").textContent = "Done.";
    byId("b").focus();
    byId("s").className = "done";
    await tick();
    expect(timeline.stop()).toMatchInlineSnapshot(`
      announce  status "Saved 3 files synced"
      focus     button "Sync"
      announce  status "Done."
      focus     button "Close"
    `);
  });

  it("announces text a change reveals alongside a silent one", async () => {
    document.body.innerHTML = `<main><p role="status">Total: <span aria-live="off" id="o">1</span><span id="r" hidden> results loaded</span></p></main>`;
    const timeline = recordTimeline(document.querySelector("main")!);
    byId("o").textContent = "2";
    byId("r").hidden = false;
    await tick();
    expect(timeline.stop()).toMatchInlineSnapshot(
      `announce  status "Total: 2 results loaded"`,
    );
  });

  it("announces a message shown in place of another, though shorter", async () => {
    document.body.innerHTML = `<main><p role="status"><span id="i">Upload incomplete</span><span id="c" hidden>Upload complete</span></p></main>`;
    const timeline = recordTimeline(document.querySelector("main")!);
    byId("i").hidden = true;
    byId("c").hidden = false;
    await tick();
    expect(timeline.stop()).toMatchInlineSnapshot(
      `announce  status "Upload complete"`,
    );
  });

  it("announces what a region shown from behind inert gains as it shows", async () => {
    document.body.innerHTML = `<section id="sec" inert><p role="status">Saved<span id="d" hidden>, 3 files synced</span></p></section>`;
    const timeline = recordTimeline(document.body);
    byId("sec").removeAttribute("inert");
    byId("d").hidden = false;
    await tick();
    expect(timeline.stop()).toMatchInlineSnapshot(
      `announce  status "Saved, 3 files synced"`,
    );
  });

  it("announces a region that drops its own aria-hidden, as one revealed", async () => {
    document.body.innerHTML = `<main><p role="alert" id="a" aria-hidden="true">Name is required.</p></main>`;
    const timeline = recordTimeline(document.querySelector("main")!);
    byId("a").removeAttribute("aria-hidden");
    await tick();
    byId("a").setAttribute("aria-hidden", "true");
    await tick();
    byId("a").removeAttribute("aria-hidden");
    await tick();
    expect(timeline.stop()).toMatchInlineSnapshot(`
      announce  alert "Name is required."
      announce  alert "Name is required."
    `);
  });

  it("stays silent for text straight under an aria-live=off host's shadow root", async () => {
    document.body.innerHTML = `<main><p role="status" id="s">Total</p></main>`;
    const timeline = recordTimeline(document.querySelector("main")!);
    const host = document.createElement("span");
    host.setAttribute("aria-live", "off");
    host.attachShadow({ mode: "open" }).textContent = " 2 items";
    byId("s").append(host);
    await tick();
    expect(timeline.stop()).toMatchInlineSnapshot(`(nothing recorded)`);
  });

  it("keeps a line before a focus move that only a silent change follows", async () => {
    document.body.innerHTML = `<main><button id="b">Done</button><p role="status"><span id="m"></span> <span aria-live="off" id="c">1</span></p></main>`;
    const timeline = recordTimeline(document.querySelector("main")!);
    byId("m").textContent = "Saved";
    byId("b").focus();
    byId("c").textContent = "2";
    await tick();
    expect(timeline.stop()).toMatchInlineSnapshot(`
      announce  status "Saved 2"
      focus     button "Done"
    `);
  });

  it("keeps a line before a focus move when the same words re-render after it", async () => {
    document.body.innerHTML = `<main><button id="b">Done</button><p role="status" id="s"></p></main>`;
    const timeline = recordTimeline(document.querySelector("main")!);
    byId("s").textContent = "Saved";
    byId("b").focus();
    byId("s").innerHTML = "<span>Saved</span>";
    await tick();
    expect(timeline.stop()).toMatchInlineSnapshot(`
      announce  status "Saved"
      focus     button "Done"
    `);
  });

  it("places words reordered after a focus move after it", async () => {
    document.body.innerHTML = `<main><button id="b">Done</button><div role="status" id="s"></div></main>`;
    const timeline = recordTimeline(document.querySelector("main")!);
    byId("s").innerHTML = `<p>Saved</p><p id="o">Offline</p>`;
    byId("b").focus();
    byId("s").prepend(byId("o"));
    await tick();
    expect(timeline.stop()).toMatchInlineSnapshot(`
      focus     button "Done"
      announce  status "Offline Saved"
    `);
  });

  it("keeps a log's new entry before a focus move that a trim follows", async () => {
    document.body.innerHTML = `<main><button id="b">Continue</button><div role="log" id="l"><p id="old">Connecting</p></div></main>`;
    const timeline = recordTimeline(document.querySelector("main")!);
    byId("l").insertAdjacentHTML("beforeend", "<p>Connected</p>");
    byId("b").focus();
    byId("old").remove();
    await tick();
    expect(timeline.stop()).toMatchInlineSnapshot(`
      announce  log "Connected"
      focus     button "Continue"
    `);
  });

  it("places slotted text changed before a focus move before it", async () => {
    document.body.innerHTML = `<div id="host"><span id="t" slot="msg"></span></div>`;
    const shadow = byId("host").attachShadow({ mode: "open" });
    shadow.innerHTML = `<main id="m"><button id="b">Sync</button><p role="status"><slot name="msg"></slot></p></main>`;
    const timeline = recordTimeline(shadow.getElementById("m")!);
    byId("t").textContent = "Saved";
    (shadow.getElementById("b") as HTMLElement).focus();
    byId("t").style.backgroundColor = "white";
    await tick();
    expect(timeline.stop()).toMatchInlineSnapshot(`
      announce  status "Saved"
      focus     button "Sync"
    `);
  });

  it("prints nothing for text a restyle or a removal takes away", async () => {
    document.body.innerHTML = `<style>.more { display: none } .open .more { display: inline }</style>
      <main id="m" class="open">
        <p role="status">Saved<span class="more">, 3 files synced</span></p>
        <div role="log"><p id="first">Sam joined.</p><p>Jo <b id="b">left</b></p></div>
      </main>`;
    const timeline = recordTimeline(byId("m"));
    byId("m").className = "";
    byId("first").remove();
    byId("b").remove();
    await tick();
    // Shown again, the text is news again.
    byId("m").className = "open";
    await tick();
    expect(timeline.stop()).toMatchInlineSnapshot(
      `announce  status "Saved, 3 files synced"`,
    );
  });

  it("announces a region inserted into another once, as itself", async () => {
    document.body.innerHTML = `<main><div role="log" id="l"></div></main>`;
    const timeline = recordTimeline(document.querySelector("main")!);
    byId("l").insertAdjacentHTML("beforeend", `<div role="status">Hi</div>`);
    await tick();
    expect(timeline.stop()).toMatchInlineSnapshot(`announce  status "Hi"`);
  });

  it("stays silent for a child inserted under its own aria-live=off", async () => {
    document.body.innerHTML = `<main><div role="status" id="s">Total</div></main>`;
    const timeline = recordTimeline(document.querySelector("main")!);
    byId("s").insertAdjacentHTML(
      "beforeend",
      `<span aria-live="off"> 2</span>`,
    );
    await tick();
    expect(timeline.stop()).toMatchInlineSnapshot(`(nothing recorded)`);
  });

  it("announces nothing from a root taken off the page in the same block", async () => {
    document.body.innerHTML = `<div role="dialog" aria-label="Edit" id="dlg"><p role="status" id="s"></p></div>`;
    const timeline = recordTimeline(byId("dlg"));
    byId("s").textContent = "Closed.";
    byId("dlg").remove();
    await tick();
    expect(timeline.stop()).toMatchInlineSnapshot(`(nothing recorded)`);
  });

  it("announces text a restyle above a shown region reveals in it", async () => {
    document.body.innerHTML = `<style>.more { display: none } .open .more { display: inline }</style>
      <main id="m"><p role="status">Saved <span class="more">3 files synced</span></p></main>`;
    const timeline = recordTimeline(byId("m"));
    byId("m").className = "open";
    await tick();
    expect(timeline.stop()).toMatchInlineSnapshot(
      `announce  status "Saved 3 files synced"`,
    );
  });

  it("announces a region inside an inserted region for itself too", async () => {
    document.body.innerHTML = `<main></main>`;
    const main = document.querySelector("main")!;
    const timeline = recordTimeline(main);
    main.insertAdjacentHTML(
      "beforeend",
      `<div role="log">Attempt 1 <p role="alert">Session expired.</p></div>`,
    );
    await tick();
    expect(timeline.stop()).toMatchInlineSnapshot(`
      announce  log "Attempt 1 Session expired."
      announce  alert "Session expired."
    `);
  });

  it("forgets a region a silent removal emptied, so the same text is news again", async () => {
    document.body.innerHTML = `<main><p role="status" id="s"><span aria-live="off" id="o">Saved.</span></p></main>`;
    const timeline = recordTimeline(document.querySelector("main")!);
    byId("o").remove();
    await tick();
    byId("s").textContent = "Saved.";
    await tick();
    expect(timeline.stop()).toMatchInlineSnapshot(`announce  status "Saved."`);
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
