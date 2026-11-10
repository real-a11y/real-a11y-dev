import { PANEL_HOST_ATTRIBUTE } from "@real-a11y-dev/core";
import { render } from "preact";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { TreeView } from "./TreeView.js";

/** Wait until `find` returns something, flushing timers: the page's changes
 *  reach the tree through the observer's debounce. */
async function waitUntil<T>(
  find: () => T | null | undefined | false,
  timeoutMs = 3000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = find();
    if (found) return found;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("Timed out");
}

/**
 * The change marks on a live page: `TreeView` compares each update of the
 * tree it reads (`usePageChanges`) and hands `TreePanel` what it found.
 */
describe("TreeView change marks", () => {
  let container: HTMLDivElement;
  let root: HTMLElement;
  let originalScrollIntoView: typeof Element.prototype.scrollIntoView;

  beforeEach(() => {
    container = document.createElement("div");
    // Marked as the inspector marks the panel's container: what is done in
    // the panel isn't done on the page, and its live region is no overlay.
    container.setAttribute(PANEL_HOST_ATTRIBUTE, "");
    document.body.appendChild(container);
    root = document.createElement("div");
    root.innerHTML = `
      <main>
        <button id="open">Open menu</button>
        <button id="save">Save</button>
      </main>
    `;
    document.body.appendChild(root);
    originalScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function () {};
  });

  afterEach(() => {
    render(null, container);
    container.remove();
    root.remove();
    Element.prototype.scrollIntoView = originalScrollIntoView;
  });

  const rowNamed = (name: string) =>
    [...container.querySelectorAll<HTMLElement>('[role="treeitem"]')].find(
      (r) => r.querySelector(".sn-name")?.textContent === name,
    );
  const bar = () => container.querySelector<HTMLElement>(".sn-changes-bar");
  const addButton = (name: string) => {
    const button = document.createElement("button");
    button.textContent = name;
    root.querySelector("main")!.appendChild(button);
  };

  it("marks what the page changed, as it changes, without saying it", async () => {
    render(<TreeView root={root} />, container);
    await waitUntil(() => rowNamed("Save"));

    addButton("Delete");
    const added = await waitUntil(() =>
      rowNamed("Delete")?.classList.contains("sn-node--change-new"),
    );
    expect(added).toBe(true);
    expect(bar()!.getAttribute("aria-label")).toBe(
      "Changes since the update before",
    );
    // Nobody caused it: marked, not said.
    expect(container.querySelector('[aria-live="polite"]')!.textContent).toBe(
      "",
    );
  });

  it("says what follows a click on the page", async () => {
    render(<TreeView root={root} />, container);
    await waitUntil(() => rowNamed("Save"));

    const open = root.querySelector("#open")!;
    open.addEventListener("click", () => addButton("Menu item"));
    open.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    (open as HTMLButtonElement).click();

    await waitUntil(
      () =>
        container.querySelector('[aria-live="polite"]')!.textContent ===
        "1 new in the tree",
    );
  });

  it("marks what reading the tree again finds, without starting over", async () => {
    render(<TreeView root={root} refreshKey={0} />, container);
    await waitUntil(() => rowNamed("Save"));
    rowNamed("Save")!.click();
    await waitUntil(
      () => rowNamed("Save")!.getAttribute("aria-selected") === "true",
    );

    root.querySelector("#save")!.textContent = "Saved";
    // Read again at once, before the page's change would be.
    render(<TreeView root={root} refreshKey={1} />, container);
    const saved = await waitUntil(() =>
      rowNamed("Saved")?.classList.contains("sn-node--change-changed")
        ? rowNamed("Saved")
        : null,
    );
    // Nothing else started over: the row is still selected.
    expect(saved.getAttribute("aria-selected")).toBe("true");
  });

  it("turns the picker's button off with the picker it makes afresh on reading again", async () => {
    render(<TreeView root={root} enablePicker refreshKey={0} />, container);
    await waitUntil(() => rowNamed("Save"));
    const pressed = () =>
      container.querySelector(".sn-pick-btn")!.getAttribute("aria-pressed");
    container.querySelector<HTMLButtonElement>(".sn-pick-btn")!.click();
    await waitUntil(() => pressed() === "true");
    render(<TreeView root={root} enablePicker refreshKey={1} />, container);
    await waitUntil(() => pressed() === "false");
  });

  it("marks nothing with markChanges off", async () => {
    render(<TreeView root={root} markChanges={false} />, container);
    await waitUntil(() => rowNamed("Save"));

    addButton("Delete");
    await waitUntil(() => rowNamed("Delete"));
    expect(container.querySelector(".sn-node--change-new")).toBeNull();
    expect(bar()).toBeNull();
    expect(container.querySelector('[aria-live="polite"]')).toBeNull();
  });

  it("marks everything since the checkpoint while it is pressed, even with markChanges off", async () => {
    render(<TreeView root={root} markChanges={false} />, container);
    await waitUntil(() => rowNamed("Save"));
    const checkpoint = container.querySelector<HTMLButtonElement>(
      '[aria-label="Checkpoint tree for diff"]',
    )!;
    checkpoint.click();
    await waitUntil(() => checkpoint.getAttribute("aria-pressed") === "true");

    addButton("Delete");
    await waitUntil(() => rowNamed("Delete"));
    root.querySelector("#save")!.textContent = "Saved";
    // The second update keeps the first's row marked: both are since the
    // checkpoint.
    await waitUntil(() =>
      rowNamed("Saved")?.classList.contains("sn-node--change-changed"),
    );
    expect(rowNamed("Delete")!.classList).toContain("sn-node--change-new");
    expect(bar()!.getAttribute("aria-label")).toBe(
      "Changes since the checkpoint",
    );

    checkpoint.click();
    await waitUntil(() => checkpoint.getAttribute("aria-pressed") === "false");
    expect(container.querySelector(".sn-node--change-new")).toBeNull();
  });

  it("marks a leaf whose text changes inside a part the tree leaves out", async () => {
    // The status is a leaf: its span is presentational. Its text changing
    // re-reads the span, not the status, whose text the extractor updates
    // where it stands.
    root
      .querySelector("main")!
      .insertAdjacentHTML(
        "beforeend",
        '<div role="status" aria-label="Status"><span role="presentation">Saved</span></div>',
      );
    render(<TreeView root={root} />, container);
    await waitUntil(() => rowNamed("Status"));

    root.querySelector('[role="status"] span')!.textContent = "Saving";
    const status = await waitUntil(() =>
      rowNamed("Status")?.classList.contains("sn-node--change-changed"),
    );
    expect(status).toBe(true);
  });

  it("says what follows an action sent through the tree", async () => {
    render(<TreeView root={root} />, container);
    await waitUntil(() => rowNamed("Save"));

    root
      .querySelector("#save")!
      .addEventListener("click", () => addButton("Undo"));
    rowNamed("Save")!.click();
    await waitUntil(
      () => rowNamed("Save")!.getAttribute("aria-selected") === "true",
    );
    const tree = container.querySelector<HTMLElement>('[role="tree"]')!;
    tree.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );

    await waitUntil(
      () =>
        container.querySelector('[aria-live="polite"]')!.textContent ===
        "1 new in the tree",
    );
  });

  it("keeps the marks between the A11Y and TAB views, which show one tree", async () => {
    render(<TreeView root={root} />, container);
    await waitUntil(() => rowNamed("Save"));

    addButton("Delete");
    await waitUntil(() =>
      rowNamed("Delete")?.classList.contains("sn-node--change-new"),
    );
    const view = (name: string) =>
      [...container.querySelectorAll<HTMLButtonElement>(".sn-toggle-btn")]
        .find((b) => b.textContent === name)!
        .click();
    view("TAB");
    await waitUntil(() => !container.querySelector('[role="tree"]'));
    view("A11Y");
    const kept = await waitUntil(() => rowNamed("Delete"));
    expect(kept.classList).toContain("sn-node--change-new");
  });

  it("doesn't take a pick of the element picker for the user acting on the page", async () => {
    render(<TreeView root={root} enablePicker />, container);
    await waitUntil(() => rowNamed("Save"));
    const pick = container.querySelector<HTMLButtonElement>(".sn-pick-btn")!;
    pick.click();
    await waitUntil(() => pick.getAttribute("aria-pressed") === "true");

    const save = root.querySelector("#save")!;
    save.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    addButton("Delete");
    await waitUntil(() =>
      rowNamed("Delete")?.classList.contains("sn-node--change-new"),
    );
    // Marked, as any update is, but not said: the pick wasn't the page's.
    expect(container.querySelector('[aria-live="polite"]')!.textContent).toBe(
      "",
    );
  });

  it("marks a row the DOM view loses to an element hidden in place", async () => {
    render(<TreeView root={root} initialViewMode="dom" />, container);
    await waitUntil(() =>
      container.querySelector('[role="treeitem"] .sn-attr-val'),
    );

    root.querySelector("#save")!.setAttribute("hidden", "");
    const summary = await waitUntil(() =>
      bar()?.querySelector(".sn-changes-summary"),
    );
    expect(summary.textContent).toContain("1 removed");
  });
});
