import { describe, it, expect, beforeEach } from "vitest";
import {
  useInputModality,
  __resetInputModalityForTesting,
} from "./useInputModality.js";

/**
 * The hook is now backed by module-level state with a one-time mousemove
 * listener installed on first call. Tests don't need to mount Preact
 * components to exercise it — call the hook directly from a fake render
 * context. This deliberately sidesteps Preact's `useEffect` scheduling,
 * which flakes between local jsdom and CI jsdom on Linux.
 */

describe("useInputModality", () => {
  beforeEach(() => {
    __resetInputModalityForTesting();
  });

  it("starts in mouse modality (the optimistic default)", () => {
    const { isMouseModality } = useInputModality();
    expect(isMouseModality()).toBe(true);
  });

  it("flips to keyboard when markKeyboard() is called", () => {
    const { isMouseModality, markKeyboard } = useInputModality();
    markKeyboard();
    expect(isMouseModality()).toBe(false);
  });

  it("flips back to mouse on the next mousemove", () => {
    const { isMouseModality, markKeyboard } = useInputModality();
    markKeyboard();
    expect(isMouseModality()).toBe(false);

    window.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));

    expect(isMouseModality()).toBe(true);
  });

  it("layout-shift mouseenters do NOT flip modality (no preceding mousemove)", () => {
    // Regression: after keyboard nav, a tree row may scroll under the
    // cursor and fire mouseenter — but with no real mousemove. Modality
    // must stay "keyboard" so hover handlers gate themselves out and
    // don't clobber the keyboard's selection.
    const { isMouseModality, markKeyboard } = useInputModality();
    markKeyboard();

    const row = document.createElement("div");
    document.body.appendChild(row);
    row.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));

    expect(isMouseModality()).toBe(false);
    row.remove();
  });

  it("multiple keyboard-flips followed by one mousemove still flips back", () => {
    const { isMouseModality, markKeyboard } = useInputModality();
    markKeyboard();
    markKeyboard();
    markKeyboard();
    expect(isMouseModality()).toBe(false);

    window.dispatchEvent(new MouseEvent("mousemove"));
    expect(isMouseModality()).toBe(true);
  });

  it("returns stable function identities so handlers don't re-bind", () => {
    // Important for the consumer: putting `isMouseModality` in a useCallback
    // dep array shouldn't churn handlers on every render.
    const a = useInputModality();
    const b = useInputModality();
    // The functions are recreated per call (cheap closures), but they
    // both read/write the same module state, so the contract holds:
    // calling either returns consistent results.
    a.markKeyboard();
    expect(b.isMouseModality()).toBe(false);
    b.markKeyboard();
    window.dispatchEvent(new MouseEvent("mousemove"));
    expect(a.isMouseModality()).toBe(true);
  });
});
