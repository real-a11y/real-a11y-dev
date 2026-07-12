import { describe, expect, it } from "vitest";

import { diffViews, stripTabIndex, viewDiffEmpty } from "./views-diff.js";

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

  describe("tab-order (numbered) diff via stripTabIndex", () => {
    // Inserting one stop at position 2 renumbers everything after it.
    const base = '1. link "Home"\n2. link "Docs"\n3. link "About"';
    const pr = '1. link "Home"\n2. link "New"\n3. link "Docs"\n4. link "About"';

    it("naive diff explodes into a renumber cascade", () => {
      const naive = diffViews(base, pr);
      expect(naive.added.length + naive.removed.length).toBeGreaterThan(2);
    });

    it("with stripTabIndex, one insertion is one added line", () => {
      expect(diffViews(base, pr, stripTabIndex)).toEqual({
        added: ['link "New"'],
        removed: [],
      });
    });

    it("a real removal still shows, minus the number", () => {
      expect(diffViews(pr, base, stripTabIndex)).toEqual({
        added: [],
        removed: ['link "New"'],
      });
    });

    it("stripTabIndex drops only a leading `NN. ` counter", () => {
      expect(stripTabIndex('42. button "Copy Code"')).toBe(
        'button "Copy Code"',
      );
      expect(stripTabIndex('link "3. steps"')).toBe('link "3. steps"');
    });
  });
});
