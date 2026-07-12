import { describe, expect, it } from "vitest";

import { diffViews, viewDiffEmpty } from "./views-diff.js";

describe("diffViews", () => {
  it("reports nothing for identical text (ignoring indentation)", () => {
    const base = 'main\n  heading "Hi"\n  button "Go"';
    const pr = 'main\n    heading "Hi"\n    button "Go"';
    expect(viewDiffEmpty(diffViews(base, pr))).toBe(true);
  });

  it("surfaces only the lines that appeared / vanished", () => {
    const base = 'main\n  button "Go"\n  link "Home"';
    const pr = 'main\n  button "Go"\n  link "Docs"';
    expect(diffViews(base, pr)).toEqual({
      added: ['link "Docs"'],
      removed: ['link "Home"'],
    });
  });

  it("is multiset-aware: a moved (re-indented) subtree is not a change", () => {
    const base = "a\n  b\n  c\n  d";
    const pr = "a\n  d\n  b\n  c"; // reordered + re-indented, same lines
    expect(viewDiffEmpty(diffViews(base, pr))).toBe(true);
  });

  it("keeps the (level N) suffix so an h2→h3 change is visible", () => {
    const base = 'heading "Intro" (level 2)';
    const pr = 'heading "Intro" (level 3)';
    expect(diffViews(base, pr)).toEqual({
      added: ['heading "Intro" (level 3)'],
      removed: ['heading "Intro" (level 2)'],
    });
  });

  it("counts duplicates: two → three of a line yields one added", () => {
    expect(diffViews("x\nx", "x\nx\nx")).toEqual({ added: ["x"], removed: [] });
  });
});
