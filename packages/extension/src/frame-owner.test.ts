import { describe, expect, it } from "vitest";

import {
  frameOwnerMark,
  isFrameHolder,
  markFrameOwner,
  newFrameMark,
  unmarkFrameOwner,
} from "./frame-owner.js";

/** A window whose frame `holder` holds; `null` for one that can't reach it. */
const frameIn = (holder: Element | null) =>
  ({ frameElement: holder }) as unknown as Window;

describe("frame owners", () => {
  it("leaves a frame's mark on the element holding it, for whoever reads that element", () => {
    const iframe = document.createElement("iframe");
    expect(frameOwnerMark(iframe)).toBeUndefined();
    expect(markFrameOwner(frameIn(iframe), "mark-a")).toBe(true);
    expect(frameOwnerMark(iframe)).toBe("mark-a");
  });

  it("puts nothing into the DOM: the mark is no attribute", () => {
    const iframe = document.createElement("iframe");
    markFrameOwner(frameIn(iframe), "mark-a");
    expect(iframe.attributes).toHaveLength(0);
    expect(iframe.outerHTML).toBe("<iframe></iframe>");
  });

  it("marks nothing from a frame that can't reach its element", () => {
    // The top frame, and a frame of another origin than its parent's, read
    // `frameElement` as null.
    expect(markFrameOwner(frameIn(null), "mark-a")).toBe(false);
    // A window that refuses the read outright.
    const refusing = Object.defineProperty({}, "frameElement", {
      get() {
        throw new DOMException("Blocked a frame", "SecurityError");
      },
    }) as unknown as Window;
    expect(markFrameOwner(refusing, "mark-a")).toBe(false);
    expect(() => unmarkFrameOwner(refusing, "mark-a")).not.toThrow();
  });

  it("replaces the mark an earlier document in the frame left", () => {
    const iframe = document.createElement("iframe");
    markFrameOwner(frameIn(iframe), "old");
    markFrameOwner(frameIn(iframe), "new");
    expect(frameOwnerMark(iframe)).toBe("new");
  });

  it("takes its own mark back, and leaves a later document's alone", () => {
    const iframe = document.createElement("iframe");
    markFrameOwner(frameIn(iframe), "old");
    unmarkFrameOwner(frameIn(iframe), "old");
    expect(frameOwnerMark(iframe)).toBeUndefined();

    markFrameOwner(frameIn(iframe), "new");
    unmarkFrameOwner(frameIn(iframe), "old");
    expect(frameOwnerMark(iframe)).toBe("new");
  });

  it("reads a mark past a form's controls, which shadow its named properties", () => {
    // A symbol is no name a control can take.
    const form = document.createElement("form");
    form.innerHTML = `<input name="frameOwner" /><input name="owner" />`;
    expect(frameOwnerMark(form)).toBeUndefined();
  });

  it("makes marks that differ, in a form the answers carry", () => {
    const marks = new Set(Array.from({ length: 200 }, newFrameMark));
    expect(marks.size).toBe(200);
    for (const mark of marks) expect(mark).toMatch(/^[0-9a-f]{24}$/);
  });

  it("knows the elements that can hold a frame", () => {
    for (const name of ["iframe", "frame", "object", "embed"]) {
      expect(isFrameHolder(name), name).toBe(true);
    }
    for (const name of ["div", "img", "video", "IFRAME", ""]) {
      expect(isFrameHolder(name), name).toBe(false);
    }
  });
});
