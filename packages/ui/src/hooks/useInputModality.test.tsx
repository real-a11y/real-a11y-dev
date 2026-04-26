import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render } from "preact";
import { useEffect } from "preact/hooks";
import { useInputModality } from "./useInputModality.js";

/**
 * Test rig — exposes the hook's return values on a global so individual
 * tests can poke `markKeyboard()` and read `isMouseModality()` without
 * spinning up Testing Library. `effectsRan` is set true by a no-op effect
 * inside the probe so beforeEach can wait for Preact's effect commit.
 */
let isMouseModality: () => boolean;
let markKeyboard: () => void;
let effectsRan = false;

function Probe() {
  const api = useInputModality();
  isMouseModality = api.isMouseModality;
  markKeyboard = api.markKeyboard;
  useEffect(() => {
    effectsRan = true;
  }, []);
  return null;
}

async function waitForEffects() {
  // Spin a few microtasks + macrotasks until Preact has run effects.
  for (let i = 0; i < 10 && !effectsRan; i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
}

describe("useInputModality", () => {
  let host: HTMLDivElement;

  beforeEach(async () => {
    effectsRan = false;
    host = document.createElement("div");
    document.body.appendChild(host);
    render(<Probe />, host);
    await waitForEffects();
  });

  afterEach(() => {
    render(null, host);
    host.remove();
  });

  it("starts in mouse modality (the optimistic default)", () => {
    expect(isMouseModality()).toBe(true);
  });

  it("flips to keyboard when markKeyboard() is called", () => {
    markKeyboard();
    expect(isMouseModality()).toBe(false);
  });

  it("flips back to mouse on the next mousemove", () => {
    markKeyboard();
    expect(isMouseModality()).toBe(false);

    window.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));

    expect(isMouseModality()).toBe(true);
  });

  it("layout-shift mouseenters do NOT flip modality (no preceding mousemove)", () => {
    // This is the regression we're guarding against. After keyboard nav, a
    // tree row may scroll under the cursor and fire mouseenter — but with
    // no real mousemove. Modality must stay "keyboard" so hover handlers
    // gate themselves out and don't clobber the keyboard's selection.
    markKeyboard();

    const row = document.createElement("div");
    document.body.appendChild(row);
    row.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));

    expect(isMouseModality()).toBe(false);
    row.remove();
  });

  it("multiple keyboard-flips followed by one mousemove still flips back", () => {
    markKeyboard();
    markKeyboard();
    markKeyboard();
    expect(isMouseModality()).toBe(false);

    window.dispatchEvent(new MouseEvent("mousemove"));
    expect(isMouseModality()).toBe(true);
  });
});
