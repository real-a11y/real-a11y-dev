import { extractA11yTree } from "@real-a11y-dev/core";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { buildTreeDiffView, EMPTY_DIFF_VIEW } from "./diff.js";

/**
 * These run against real extractions rather than hand-built `ExtractionResult`
 * literals on purpose: node ids come from core's element WeakMap, and the whole
 * premise of the highlight ("a row that survived the interaction keeps its id")
 * is core's behavior, not ours. Faking the ids would test the fake.
 */
describe("buildTreeDiffView", () => {
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement("div");
    host.innerHTML = `
      <main>
        <button id="open">Open menu</button>
        <p id="status">Ready</p>
      </main>
    `;
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
  });

  function extract() {
    return extractA11yTree(host);
  }

  function idOf(result: ReturnType<typeof extract>, selector: string): string {
    const el = host.querySelector(selector);
    if (!el) throw new Error(`No element for ${selector}`);
    for (const [id, node] of result.nodes) {
      if (node.a11y.name === el.textContent?.trim()) return id;
    }
    throw new Error(`No node for ${selector}`);
  }

  it("reports nothing when the tree is untouched", () => {
    const baseline = extract();
    const view = buildTreeDiffView(baseline, extract());

    expect(view.status.size).toBe(0);
    expect(view.removed).toEqual([]);
  });

  it("marks a node that appeared as added", () => {
    const baseline = extract();

    const added = document.createElement("button");
    added.textContent = "Save";
    host.querySelector("main")?.appendChild(added);

    const current = extract();
    const view = buildTreeDiffView(baseline, current);

    const addedId = idOf(current, "main button:last-of-type");
    expect(view.status.get(addedId)).toBe("added");
    // The untouched button keeps its id and stays unmarked.
    expect(view.status.get(idOf(current, "#open"))).toBeUndefined();
    expect(view.removed).toEqual([]);
  });

  it("marks a surviving node whose accessible name changed", () => {
    const baseline = extract();

    const status = host.querySelector("#status") as HTMLElement;
    status.textContent = "Saving…";

    const current = extract();
    const view = buildTreeDiffView(baseline, current);

    expect(view.status.get(idOf(current, "#status"))).toBe("changed");
  });

  it("hands back removed nodes separately — they have no row to mark", () => {
    const baseline = extract();
    const removedId = idOf(baseline, "#open");

    host.querySelector("#open")?.remove();

    const current = extract();
    const view = buildTreeDiffView(baseline, current);

    // Not in `status`: the element is gone, so nothing in the current tree
    // could carry the mark.
    expect(view.status.has(removedId)).toBe(false);
    expect(view.removed.map((n) => n.id)).toContain(removedId);
  });

  it("exposes an empty view constant", () => {
    expect(EMPTY_DIFF_VIEW.status.size).toBe(0);
    expect(EMPTY_DIFF_VIEW.removed).toEqual([]);
  });
});
