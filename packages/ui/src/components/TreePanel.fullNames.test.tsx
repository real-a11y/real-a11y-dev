import { extractA11yTree, extractDomTree } from "@real-a11y-dev/core";
import { render } from "preact";
import { act } from "preact/test-utils";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { TreePanel, type TreePanelProps } from "./TreePanel.js";

const LONG_NAME =
  "Página principal de la enciclopedia libre y políglota de la Fundación Wikimedia";

/**
 * "Show full names": off by default, a long name ends in an ellipsis and the
 * tree fits the panel (tree.css, "Long labels"); on, `.sn-tree--full-names`
 * sizes the tree to its widest row. jsdom has no layout, so what is checked
 * here is the wiring: the class, the Settings switch, and the whole text a
 * clipped part of a label carries as its tooltip.
 */
describe("TreePanel — Show full names", () => {
  let host: HTMLElement;
  let container: HTMLElement;

  beforeEach(() => {
    host = document.createElement("div");
    host.innerHTML = `
      <main>
        <a href="/wiki/Portada" id="home" class="mw-link mw-internal">${LONG_NAME}</a>
        <p><code>const answer = 42;</code></p>
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

  function panel(props: Partial<TreePanelProps> = {}) {
    act(() => {
      render(
        <TreePanel
          treeData={extractA11yTree(host)}
          viewMode="a11y"
          onViewModeChange={() => {}}
          {...props}
        />,
        container,
      );
    });
  }

  const tree = () => container.querySelector<HTMLElement>('[role="tree"]')!;
  /** The switch, with Settings opened if it isn't already. */
  const fullNamesBox = () => {
    const gear = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Settings"]',
    )!;
    if (gear.getAttribute("aria-expanded") !== "true") act(() => gear.click());
    return container.querySelector<HTMLInputElement>(
      '[role="group"][aria-label="Settings"] input[type="checkbox"]',
    )!;
  };

  // Looked up outside `act`: a nested one's render is held to the outer's end.
  const toggle = (box: HTMLInputElement) => act(() => box.click());

  it("starts with names clipped, unless told to start with them in full", () => {
    panel();
    expect(tree().classList.contains("sn-tree--full-names")).toBe(false);
    expect(fullNamesBox().checked).toBe(false);

    render(null, container);
    panel({ defaultShowFullNames: true });
    expect(tree().classList.contains("sn-tree--full-names")).toBe(true);
    expect(fullNamesBox().checked).toBe(true);
  });

  it("turns full names on and off from Settings, and says so", () => {
    const onChange = vi.fn();
    panel({ onShowFullNamesChange: onChange });

    toggle(fullNamesBox());
    expect(tree().classList.contains("sn-tree--full-names")).toBe(true);
    expect(onChange).toHaveBeenLastCalledWith(true);

    toggle(fullNamesBox());
    expect(tree().classList.contains("sn-tree--full-names")).toBe(false);
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it("keeps the choice when the tree data changes", () => {
    panel();
    toggle(fullNamesBox());

    panel({ treeData: extractA11yTree(host) });
    expect(tree().classList.contains("sn-tree--full-names")).toBe(true);
  });

  it("gives a name and a text preview their whole text as a tooltip", () => {
    panel();
    const name = [...container.querySelectorAll(".sn-name")].find((el) =>
      el.textContent?.startsWith("Página"),
    );
    expect(name?.getAttribute("title")).toBe(LONG_NAME);
    const preview = container.querySelector(".sn-name-preview");
    expect(preview?.getAttribute("title")).toBe(preview?.textContent);
  });

  it("gives DOM mode's attributes and text the same, each attribute whole", () => {
    act(() => {
      render(
        <TreePanel
          treeData={extractDomTree(host)}
          viewMode="dom"
          onViewModeChange={() => {}}
        />,
        container,
      );
    });
    const attrs = [...container.querySelectorAll(".sn-attr")].map((el) =>
      el.getAttribute("title"),
    );
    expect(attrs).toContain('href="/wiki/Portada"');
    expect(attrs).toContain('class="mw-link mw-internal"');
    const text = [...container.querySelectorAll(".sn-text-content")].find(
      (el) => el.textContent === LONG_NAME,
    );
    expect(text?.getAttribute("title")).toBe(LONG_NAME);
  });

  it("keeps a row's key states with its name, and the other badges after its text", () => {
    host
      .querySelector("main")!
      .insertAdjacentHTML(
        "beforeend",
        `<button aria-pressed="true">${LONG_NAME}</button>`,
      );
    const badges = (row: Element | undefined, selector: string) =>
      [...(row?.querySelectorAll(selector) ?? [])].map((b) => b.textContent);
    const buttonRow = (match: (row: Element) => boolean) =>
      [...container.querySelectorAll('[role="treeitem"]')].find(match);

    panel();
    const row = buttonRow(
      (r) => r.querySelector(".sn-role")?.textContent === "button",
    );
    expect(badges(row, ".sn-head > .sn-name ~ .sn-badges > .sn-badge")).toEqual(
      ["pressed"],
    );
    expect(badges(row, ".sn-label > .sn-badges > .sn-badge")).toEqual([
      "interactive",
      "focusable",
    ]);

    // The DOM view has no head: there they all follow the element's text.
    act(() => {
      render(
        <TreePanel
          treeData={extractDomTree(host)}
          viewMode="dom"
          onViewModeChange={() => {}}
        />,
        container,
      );
    });
    const domRow = buttonRow(
      (r) => r.querySelector(".sn-tag")?.textContent === "<button",
    );
    expect(badges(domRow, ".sn-label > .sn-badges > .sn-badge")).toEqual([
      "interactive",
      "focusable",
      "pressed",
    ]);
  });
});
