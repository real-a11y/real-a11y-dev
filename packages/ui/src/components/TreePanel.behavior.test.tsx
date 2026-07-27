import { extractA11yTree, type ExtractionResult } from "@real-a11y-dev/core";
import { render } from "preact";
import { act } from "preact/test-utils";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { TreePanel } from "./TreePanel.js";

async function waitFor(
  root: ParentNode,
  selector: string,
  timeoutMs = 2000,
): Promise<Element> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const el = root.querySelector(selector);
    if (el) return el;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`Timed out waiting for selector: ${selector}`);
}

/**
 * Behavioral coverage for TreePanel wiring beyond the dedicated diff suite:
 * picker → ancestor expansion + selection, expand/collapse all, tab-mode
 * role-filter clearing, and aria-controls jump chips.
 */
describe("TreePanel behavior", () => {
  let host: HTMLElement;
  let container: HTMLElement;
  let originalScrollIntoView: typeof Element.prototype.scrollIntoView;

  beforeEach(() => {
    host = document.createElement("div");
    host.innerHTML = `
      <main>
        <button id="open" aria-controls="menu" aria-expanded="true">Open</button>
        <ul id="menu" role="menu">
          <li role="menuitem">One</li>
        </ul>
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

  function panel(
    treeData: ExtractionResult,
    props: Record<string, unknown> = {},
  ) {
    act(() => {
      render(
        <TreePanel
          treeData={treeData}
          viewMode={(props.viewMode as "a11y" | "dom" | "tab") ?? "a11y"}
          onViewModeChange={
            (props.onViewModeChange as (m: "a11y" | "dom" | "tab") => void) ??
            (() => {})
          }
          {...props}
        />,
        container,
      );
    });
  }

  it("applies a picked node by expanding ancestors and acknowledging the pick", async () => {
    const tree = extractA11yTree(host);
    for (const node of tree.nodes.values()) {
      if (node.ui && node.childIds.length > 0) node.ui.expanded = false;
    }
    const handled = vi.fn();
    const target = [...tree.nodes.values()].find(
      (n) => n.a11y.name === "One" || n.a11y.role === "menuitem",
    );
    expect(target).toBeTruthy();

    panel(tree, {
      pickedNodeId: target!.id,
      onPickedNodeHandled: handled,
    });

    await waitFor(container, `[data-node-id="${target!.id}"]`);
    expect(handled).toHaveBeenCalled();
    expect(
      container.querySelector(
        `[data-node-id="${target!.id}"][aria-selected="true"]`,
      ),
    ).not.toBeNull();
  });

  it("acknowledges an unknown picked id without selecting", () => {
    const tree = extractA11yTree(host);
    const handled = vi.fn();
    panel(tree, {
      pickedNodeId: "missing-node",
      onPickedNodeHandled: handled,
    });
    expect(handled).toHaveBeenCalled();
    expect(container.querySelector('[aria-selected="true"]')).toBeNull();
  });

  it("dispatches the primary action from a row action button", async () => {
    const tree = extractA11yTree(host);
    const onActivate = vi.fn();
    panel(tree, { onActivate });

    const actionBtn = await waitFor(container, ".sn-action");
    const row = actionBtn.closest<HTMLElement>("[data-node-id]")!;
    act(() => {
      (actionBtn as HTMLButtonElement).click();
    });
    expect(onActivate).toHaveBeenCalled();
    expect(onActivate.mock.calls[0]![0]).toBe(row.getAttribute("data-node-id"));
    expect(typeof onActivate.mock.calls[0]![1]).toBe("string");
  });

  it("expand-all / collapse-all mutate visibility of child rows", async () => {
    const tree = extractA11yTree(host);
    for (const node of tree.nodes.values()) {
      if (node.ui && node.depth > 0) node.ui.expanded = false;
    }
    panel(tree);
    await waitFor(container, '[aria-label="Expand all nodes"]');

    const before = container.querySelectorAll('[role="treeitem"]').length;
    act(() => {
      container
        .querySelector<HTMLButtonElement>('[aria-label="Expand all nodes"]')!
        .click();
    });
    const afterExpand = container.querySelectorAll('[role="treeitem"]').length;
    expect(afterExpand).toBeGreaterThan(before);

    act(() => {
      container
        .querySelector<HTMLButtonElement>('[aria-label="Collapse all nodes"]')!
        .click();
    });
    const afterCollapse =
      container.querySelectorAll('[role="treeitem"]').length;
    expect(afterCollapse).toBeLessThan(afterExpand);
  });

  it("clears the role filter when switching into tab mode", async () => {
    const tree = extractA11yTree(host);
    let mode: "a11y" | "dom" | "tab" = "a11y";
    const onViewModeChange = vi.fn((next: "a11y" | "dom" | "tab") => {
      mode = next;
      panel(tree, { viewMode: next, onViewModeChange });
    });
    panel(tree, { viewMode: mode, onViewModeChange });

    const buttonsChip = [...container.querySelectorAll(".sn-filter-btn")].find(
      (el) => el.textContent === "Buttons",
    ) as HTMLButtonElement | undefined;
    expect(buttonsChip).toBeTruthy();
    act(() => {
      buttonsChip!.click();
    });
    await waitFor(container, '[aria-label="button elements"]');

    const tabBtn = [...container.querySelectorAll(".sn-toggle-btn")].find(
      (el) => el.textContent === "TAB",
    ) as HTMLButtonElement;
    act(() => {
      tabBtn.click();
    });
    expect(onViewModeChange).toHaveBeenCalledWith("tab");
    await waitFor(container, '[aria-label="Tab sequence"]');
    expect(
      container.querySelector('[aria-label="button elements"]'),
    ).toBeNull();
  });

  it("renders an aria-controls jump chip on the trigger", async () => {
    const tree = extractA11yTree(host);
    // Ensure ancestors are expanded so the Open button row is mounted.
    for (const node of tree.nodes.values()) {
      if (node.ui && node.childIds.length > 0) node.ui.expanded = true;
    }
    panel(tree);
    const chip = await waitFor(container, ".sn-controls-link");
    expect(chip.getAttribute("title") ?? "").toMatch(/controls/i);
    expect(chip.textContent).toMatch(/→/);
  });
});
