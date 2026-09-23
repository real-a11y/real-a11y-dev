import { extractA11yTree } from "@real-a11y-dev/core";
import { render } from "preact";
import { act } from "preact/test-utils";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import type { ControlsLink } from "./TreePanel.js";

/**
 * Records the cross-link props each row is handed, per render pass.
 *
 * TreeNode is stubbed rather than spied on because the defect is about the
 * *identity* of the arrays TreePanel builds, which is invisible in the DOM.
 */
interface RowLinks {
  controls?: ControlsLink[];
  controlledBy?: ControlsLink[];
}

const recorder = vi.hoisted(() => ({
  passes: [] as Array<Map<string, RowLinks>>,
  current: null as Map<string, RowLinks> | null,
}));

vi.mock("./TreeNode.js", () => ({
  TreeNode: (props: {
    node: { id: string };
    controlsLinks?: ControlsLink[];
    controlledByLinks?: ControlsLink[];
  }) => {
    if (!recorder.current) {
      recorder.current = new Map();
      recorder.passes.push(recorder.current);
    }
    // Both directions are recorded separately: a row can hold forward AND
    // reverse links at once (TreePanel merges them into one entry), and
    // collapsing them into a single slot would stop checking one of them.
    recorder.current.set(props.node.id, {
      controls: props.controlsLinks,
      controlledBy: props.controlledByLinks,
    });
    // Deliberately not role="treeitem" — the stub stands in for the row only
    // to capture its props, and a bare treeitem without aria-selected is an
    // a11y lint error in its own right.
    return <div data-node-id={props.node.id} />;
  },
}));

const { TreePanel } = await import("./TreePanel.js");

/**
 * Guards the per-render cost of the aria-controls jump chips.
 *
 * The chip arrays used to be rebuilt inside TreePanel's render loop, so every
 * rendered row re-ran `nodes.get` + label formatting for each of its links on
 * every render — including renders caused by plain arrow-key selection, which
 * change no tree data at all — and handed TreeNode a brand-new array each
 * time. They are now resolved once per tree, so an unchanged row keeps the
 * same array identity across renders (which is also what makes memoizing the
 * row component possible at all).
 */
describe("TreePanel cross-link cost", () => {
  let host: HTMLElement;
  let container: HTMLElement;
  let originalScrollIntoView: typeof Element.prototype.scrollIntoView;

  beforeEach(() => {
    recorder.passes = [];
    recorder.current = null;
    host = document.createElement("div");
    host.innerHTML = `
      <main>
        <button id="open" aria-controls="menu" aria-expanded="true">Open</button>
        <ul id="menu" role="menu" aria-controls="panel">
          <li role="menuitem">One</li>
        </ul>
        <div id="panel" role="region" aria-label="Details">Details</div>
        <button type="button">Save</button>
      </main>
    `;
    document.body.appendChild(host);
    container = document.createElement("div");
    document.body.appendChild(container);
    originalScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function () {};
  });

  afterEach(() => {
    render(null, container);
    container.remove();
    host.remove();
    Element.prototype.scrollIntoView = originalScrollIntoView;
  });

  it("hands unchanged rows the same jump-chip arrays across re-renders", () => {
    const treeData = extractA11yTree(host);

    act(() => {
      render(
        <TreePanel
          treeData={treeData}
          viewMode="a11y"
          onViewModeChange={() => {}}
        />,
        container,
      );
    });

    const tree = container.querySelector<HTMLElement>('[role="tree"]')!;
    const first = recorder.passes[0];
    const linkedIds = [...first].filter(
      ([, v]) => v.controls !== undefined || v.controlledBy !== undefined,
    );
    // The fixture really does produce cross-links in both directions, and at
    // least one row (the menu) carries both at once — that row is the one
    // that exercises TreePanel's forward/reverse merge.
    expect(linkedIds.length).toBeGreaterThan(0);
    expect(
      linkedIds.some(
        ([, v]) => v.controls !== undefined && v.controlledBy !== undefined,
      ),
    ).toBe(true);

    // Arrow-key selection re-renders the list without touching tree data.
    recorder.current = null;
    act(() => {
      tree.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowDown",
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    const second = recorder.passes[recorder.passes.length - 1];
    expect(second).not.toBe(first);
    for (const [id, links] of linkedIds) {
      const after = second.get(id);
      expect(after?.controls).toBe(links.controls);
      expect(after?.controlledBy).toBe(links.controlledBy);
    }
  });
});
