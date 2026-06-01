import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createPicker, type PickerOptions } from "./picker.js";

interface Harness {
  root: HTMLElement;
  trackedDiv: HTMLElement;
  untrackedDiv: HTMLElement;
  nestedSpan: HTMLElement;
  refs: Map<Element, string>;
  highlights: string[];
  clears: number;
  picks: string[];
  modes: boolean[];
}

function makeHarness(overrides: Partial<PickerOptions> = {}): {
  picker: ReturnType<typeof createPicker>;
  harness: Harness;
} {
  const root = document.createElement("div");
  root.innerHTML = `
    <div id="tracked">
      <span id="nested">nested</span>
    </div>
    <div id="untracked">no id here</div>
  `;
  document.body.appendChild(root);

  const trackedDiv = root.querySelector("#tracked") as HTMLElement;
  const untrackedDiv = root.querySelector("#untracked") as HTMLElement;
  const nestedSpan = root.querySelector("#nested") as HTMLElement;

  // Only #tracked is registered. The nested <span> walks up to find it
  // (mirrors the DOM-walk fallback in elementRefs.findId resolution).
  const refs = new Map<Element, string>();
  refs.set(trackedDiv, "n1");

  const highlights: string[] = [];
  let clears = 0;
  const picks: string[] = [];
  const modes: boolean[] = [];

  const picker = createPicker({
    doc: document,
    isSubFrame: false,
    findId: (el) => refs.get(el),
    onHighlight: (id) => highlights.push(id),
    onClearHighlight: () => {
      clears++;
    },
    onPicked: (id) => picks.push(id),
    onModeChange: (enabled) => modes.push(enabled),
    ...overrides,
  });

  return {
    picker,
    harness: {
      root,
      trackedDiv,
      untrackedDiv,
      nestedSpan,
      refs,
      highlights,
      get clears() {
        return clears;
      },
      picks,
      modes,
    } as Harness,
  };
}

describe("createPicker", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    document.body.style.cursor = "";
  });

  afterEach(() => {
    document.body.innerHTML = "";
    document.body.style.cursor = "";
  });

  it("starts disabled", () => {
    const { picker } = makeHarness();
    expect(picker.isEnabled()).toBe(false);
  });

  it("setEnabled(true) installs listeners, swaps the cursor, and fires onModeChange", () => {
    const { picker, harness } = makeHarness();

    expect(document.body.style.cursor).toBe("");

    picker.setEnabled(true);

    expect(picker.isEnabled()).toBe(true);
    expect(document.body.style.cursor).toBe("crosshair");
    expect(harness.modes).toEqual([true]);
  });

  it("setEnabled(false) removes listeners, restores cursor, and clears the highlight", () => {
    const { picker, harness } = makeHarness();
    document.body.style.cursor = "wait"; // pre-existing cursor

    picker.setEnabled(true);
    expect(document.body.style.cursor).toBe("crosshair");

    picker.setEnabled(false);

    expect(picker.isEnabled()).toBe(false);
    expect(document.body.style.cursor).toBe("wait");
    // Disable always clears any in-flight highlight so the overlay doesn't
    // linger after the user exits pick mode.
    expect(harness.clears).toBeGreaterThanOrEqual(1);
    expect(harness.modes).toEqual([true, false]);
  });

  it("setEnabled is idempotent — calling with the current state is a no-op", () => {
    const { picker, harness } = makeHarness();

    picker.setEnabled(false); // already off — no-op
    picker.setEnabled(true);
    picker.setEnabled(true); // already on — no-op
    picker.setEnabled(false);
    picker.setEnabled(false); // already off — no-op

    expect(harness.modes).toEqual([true, false]);
  });

  it("mousemove over a tracked element calls onHighlight with its id", () => {
    const { picker, harness } = makeHarness();
    picker.setEnabled(true);

    const evt = new MouseEvent("mousemove", { bubbles: true });
    Object.defineProperty(evt, "target", { value: harness.trackedDiv });
    document.dispatchEvent(evt);

    expect(harness.highlights).toEqual(["n1"]);
  });

  it("mousemove over an untracked element calls onClearHighlight", () => {
    const { picker, harness } = makeHarness();
    picker.setEnabled(true);
    const clearsBefore = harness.clears;

    const evt = new MouseEvent("mousemove", { bubbles: true });
    Object.defineProperty(evt, "target", { value: harness.untrackedDiv });
    document.dispatchEvent(evt);

    expect(harness.highlights).toEqual([]);
    expect(harness.clears).toBe(clearsBefore + 1);
  });

  it("mousemove on a descendant of a tracked element walks up and highlights the ancestor", () => {
    const { picker, harness } = makeHarness();
    picker.setEnabled(true);

    const evt = new MouseEvent("mousemove", { bubbles: true });
    Object.defineProperty(evt, "target", { value: harness.nestedSpan });
    document.dispatchEvent(evt);

    // The nested span has no entry of its own, but #tracked is its
    // ancestor — resolution walks parentElement until it finds an id.
    expect(harness.highlights).toEqual(["n1"]);
  });

  it("click on a tracked element prevents default, sends NODE_PICKED, and exits pick mode", () => {
    const { picker, harness } = makeHarness();
    picker.setEnabled(true);

    const evt = new MouseEvent("click", { bubbles: true, cancelable: true });
    Object.defineProperty(evt, "target", { value: harness.trackedDiv });
    document.dispatchEvent(evt);

    expect(harness.picks).toEqual(["n1"]);
    expect(evt.defaultPrevented).toBe(true);
    expect(picker.isEnabled()).toBe(false);
    // Disabling at the tail of a successful pick also clears any
    // in-flight highlight and restores the cursor.
    expect(document.body.style.cursor).toBe("");
  });

  it("click on an untracked element still exits pick mode but does NOT pick", () => {
    const { picker, harness } = makeHarness();
    picker.setEnabled(true);

    const evt = new MouseEvent("click", { bubbles: true, cancelable: true });
    Object.defineProperty(evt, "target", { value: harness.untrackedDiv });
    document.dispatchEvent(evt);

    expect(harness.picks).toEqual([]);
    expect(evt.defaultPrevented).toBe(true);
    // Even an unsuccessful pick exits pick mode so the user doesn't get
    // stuck clicking through whitespace with no feedback.
    expect(picker.isEnabled()).toBe(false);
  });

  it("click stops propagation so the page's own click handlers don't fire", () => {
    const { picker, harness } = makeHarness();
    const pageHandler = vi.fn();
    harness.trackedDiv.addEventListener("click", pageHandler);

    picker.setEnabled(true);

    const evt = new MouseEvent("click", { bubbles: true, cancelable: true });
    Object.defineProperty(evt, "target", { value: harness.trackedDiv });
    document.dispatchEvent(evt);

    // The picker listens at the capture phase + stopPropagation, so the
    // page's bubble-phase listener never sees the click.
    expect(pageHandler).not.toHaveBeenCalled();
  });

  it("Escape key exits pick mode without selecting", () => {
    const { picker, harness } = makeHarness();
    picker.setEnabled(true);

    const evt = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(evt);

    expect(harness.picks).toEqual([]);
    expect(picker.isEnabled()).toBe(false);
    expect(evt.defaultPrevented).toBe(true);
  });

  it("non-Escape keys do not exit pick mode", () => {
    const { picker } = makeHarness();
    picker.setEnabled(true);

    for (const key of ["Tab", "Enter", " ", "ArrowDown", "a"]) {
      document.dispatchEvent(new KeyboardEvent("keydown", { key }));
    }

    expect(picker.isEnabled()).toBe(true);
  });

  it("after disable, mousemove and click handlers are no longer attached", () => {
    const { picker, harness } = makeHarness();
    picker.setEnabled(true);
    picker.setEnabled(false);

    const moveEvt = new MouseEvent("mousemove", { bubbles: true });
    Object.defineProperty(moveEvt, "target", { value: harness.trackedDiv });
    document.dispatchEvent(moveEvt);

    const clickEvt = new MouseEvent("click", { bubbles: true });
    Object.defineProperty(clickEvt, "target", { value: harness.trackedDiv });
    document.dispatchEvent(clickEvt);

    // Both highlight and pick should have only the calls from while
    // pick mode was active (none in this test, since we only enabled +
    // disabled without dispatching anything in between).
    expect(harness.highlights).toEqual([]);
    expect(harness.picks).toEqual([]);
  });

  it("teardown() force-disables without firing onModeChange a second time", () => {
    const { picker, harness } = makeHarness();
    picker.setEnabled(true);

    picker.teardown();

    expect(picker.isEnabled()).toBe(false);
    // teardown is for forced cleanup (orphaned content script); it doesn't
    // fire onModeChange because there's no panel to notify at that point.
    expect(harness.modes).toEqual([true]);
    // Listeners are still removed though.
    const evt = new MouseEvent("click", { bubbles: true, cancelable: true });
    Object.defineProperty(evt, "target", { value: harness.trackedDiv });
    document.dispatchEvent(evt);
    expect(harness.picks).toEqual([]);
  });

  it("teardown() when already disabled is a no-op", () => {
    const { picker, harness } = makeHarness();

    picker.teardown();

    expect(picker.isEnabled()).toBe(false);
    expect(harness.modes).toEqual([]);
  });

  it("isSubFrame=true skips the body cursor swap on both enable and disable", () => {
    const { picker } = makeHarness({ isSubFrame: true });
    document.body.style.cursor = "default";

    picker.setEnabled(true);
    // The cursor swap is top-frame-only — the user would otherwise see
    // the cursor flip inside iframes too, which is jarring.
    expect(document.body.style.cursor).toBe("default");

    picker.setEnabled(false);
    expect(document.body.style.cursor).toBe("default");
  });

  it("preserves an empty starting cursor and restores it on disable", () => {
    const { picker } = makeHarness();
    expect(document.body.style.cursor).toBe("");

    picker.setEnabled(true);
    expect(document.body.style.cursor).toBe("crosshair");

    picker.setEnabled(false);
    expect(document.body.style.cursor).toBe("");
  });

  it("findId returning undefined for every element gracefully no-ops on click + move", () => {
    const { picker, harness } = makeHarness({ findId: () => undefined });
    picker.setEnabled(true);

    const move = new MouseEvent("mousemove", { bubbles: true });
    Object.defineProperty(move, "target", { value: harness.trackedDiv });
    document.dispatchEvent(move);

    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    Object.defineProperty(click, "target", { value: harness.trackedDiv });
    document.dispatchEvent(click);

    expect(harness.highlights).toEqual([]);
    expect(harness.picks).toEqual([]);
    // Pick mode still exits on click even when no tracked id was found.
    expect(picker.isEnabled()).toBe(false);
  });
});
