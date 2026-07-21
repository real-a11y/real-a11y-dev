import { extractA11yTree, type ExtractionResult } from "@real-a11y-dev/core";
import { render } from "preact";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { buildTreeDiffView, EMPTY_DIFF_VIEW } from "../diff.js";

import { TreePanel } from "./TreePanel.js";

/**
 * Rendering side of the diff mode. `TreePanel` is the pure component, so the
 * baseline is supplied directly rather than captured through the toolbar —
 * that keeps these deterministic and independent of Preact's effect timing.
 *
 * This is an accessibility tool, so the diff indication itself has to be
 * accessible: WCAG 1.4.1 (Use of Color) means the marker cannot be a
 * background tint alone, and screen-reader users need the status in text.
 */
describe("TreePanel diff mode", () => {
  let host: HTMLElement;
  let container: HTMLElement;

  beforeEach(() => {
    host = document.createElement("div");
    host.innerHTML = `
      <main>
        <button id="open">Open menu</button>
      </main>
    `;
    document.body.appendChild(host);

    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    container.remove();
    host.remove();
  });

  function panel(treeData: ExtractionResult, props: Record<string, unknown>) {
    render(
      <TreePanel
        treeData={treeData}
        viewMode="a11y"
        onViewModeChange={() => {}}
        {...props}
      />,
      container,
    );
  }

  it("renders no diff affordances when no baseline is captured", () => {
    panel(extractA11yTree(host), { enableDiff: true });

    expect(container.querySelector(".sn-diff-marker")).toBeNull();
    expect(container.querySelector(".sn-removed")).toBeNull();
    // The toolbar button is still offered — that is how you capture one.
    expect(
      container.querySelector('[aria-label="Checkpoint tree for diff"]'),
    ).not.toBeNull();
  });

  it("omits the checkpoint button when the feature is off", () => {
    panel(extractA11yTree(host), { enableDiff: false });

    expect(
      container.querySelector('[aria-label="Checkpoint tree for diff"]'),
    ).toBeNull();
  });

  it("marks added rows with more than color, and names the status in text", () => {
    const baseline = extractA11yTree(host);

    const added = document.createElement("button");
    added.textContent = "Save";
    host.querySelector("main")?.appendChild(added);

    const current = extractA11yTree(host);
    panel(current, {
      enableDiff: true,
      diffActive: true,
      diff: buildTreeDiffView(baseline, current),
    });

    const marked = container.querySelector(".sn-node--added");
    expect(marked).not.toBeNull();

    // WCAG 1.4.1: a visible glyph carries the meaning, not just the tint.
    const marker = marked?.querySelector(".sn-diff-marker");
    expect(marker?.textContent).toContain("+");
    // ...and the status reaches assistive tech as words.
    expect(marker?.querySelector(".sn-sr-only")?.textContent).toBe("added ");
    // The glyph itself is not announced twice.
    expect(marker?.querySelector('[aria-hidden="true"]')?.textContent).toBe(
      "+",
    );
  });

  it("reserves the marker gutter on unmarked rows so labels stay aligned", () => {
    const baseline = extractA11yTree(host);

    const added = document.createElement("button");
    added.textContent = "Save";
    host.querySelector("main")?.appendChild(added);

    const current = extractA11yTree(host);
    panel(current, {
      enableDiff: true,
      diffActive: true,
      diff: buildTreeDiffView(baseline, current),
    });

    // Every rendered row carries a marker slot while a diff is active — the
    // fixed-width column would otherwise push marked labels right of their
    // unmarked neighbours (WCAG-adjacent, but really just visual raggedness).
    const rows = container.querySelectorAll(".sn-node");
    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows) {
      expect(row.querySelector(".sn-diff-marker")).not.toBeNull();
    }

    // The unmarked rows reserve the slot but paint no glyph and announce
    // nothing — the gutter is empty, not a phantom "added"/"changed".
    const unmarked = container.querySelector(
      ".sn-node:not(.sn-node--added):not(.sn-node--changed)",
    );
    expect(unmarked).not.toBeNull();
    const emptySlot = unmarked?.querySelector(".sn-diff-marker");
    expect(emptySlot?.textContent).toBe("");
    expect(emptySlot?.className).toBe("sn-diff-marker");
  });

  it("renders no marker slot at all when no diff is active", () => {
    // With no baseline the gutter must not exist, so the tree looks exactly
    // as it did before the feature — no permanent rightward shift.
    panel(extractA11yTree(host), { enableDiff: true });

    expect(container.querySelector(".sn-diff-marker")).toBeNull();
  });

  it("summarizes removed nodes instead of rendering them as rows", () => {
    const baseline = extractA11yTree(host);
    host.querySelector("#open")?.remove();

    const current = extractA11yTree(host);
    const view = buildTreeDiffView(baseline, current);
    expect(view.removed.length).toBeGreaterThan(0);

    panel(current, { enableDiff: true, diffActive: true, diff: view });

    const removed = container.querySelector(".sn-removed");
    expect(removed).not.toBeNull();
    // A native <details> — no aria-expanded or id bookkeeping to get wrong.
    expect(removed?.tagName).toBe("DETAILS");
    expect(removed?.querySelector("summary")?.textContent).toContain("removed");
    // Removed entries are not tree rows: they are not focusable, and they
    // carry no treeitem semantics that would imply an actionable element.
    expect(removed?.querySelector('[role="treeitem"]')).toBeNull();
    expect(removed?.querySelector("[tabindex]")).toBeNull();
  });

  it("reserves the gutter but highlights nothing for a present-but-empty diff", () => {
    // A live checkpoint that has seen no changes yet is a present, empty diff
    // (structurally identical to EMPTY_DIFF_VIEW). It reserves the gutter — so
    // the layout is stable the moment the first change lands — but paints no
    // glyph and shows no removed section. `undefined` is the dormant signal,
    // not an empty view.
    panel(extractA11yTree(host), {
      enableDiff: true,
      diffActive: true,
      diff: EMPTY_DIFF_VIEW,
    });

    const slots = container.querySelectorAll(".sn-diff-marker");
    expect(slots.length).toBeGreaterThan(0);
    for (const slot of slots) {
      expect(slot.textContent).toBe(""); // reserved, nothing painted
      expect(slot.className).toBe("sn-diff-marker"); // no --added/--changed
    }
    expect(container.querySelector(".sn-removed")).toBeNull();
  });
});
