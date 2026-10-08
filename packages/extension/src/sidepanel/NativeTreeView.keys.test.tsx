import { render } from "preact";
import { act } from "preact/test-utils";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import type { NativeNode } from "../native/native-actions.js";

import { NativeTreeView } from "./NativeTreeView.js";

/**
 * What the native tree gained to match the DOM tree: type-ahead and `*`,
 * Enter/Shift+Enter on a slider or spinbutton, the heading-level and iframe
 * badges, and the keyboard bar and dialog indicator.
 */

function node(
  id: string,
  role: string,
  name: string,
  depth: number,
  childIds: string[] = [],
  extra: Partial<NativeNode> = {},
): [string, NativeNode] {
  return [
    id,
    { id, role, name, depth, childIds, states: {}, properties: {}, ...extra },
  ];
}

const NODES = new Map<string, NativeNode>([
  node("root", "document", "", 0, ["nav", "main"]),
  node("nav", "navigation", "Site", 1, ["home"]),
  node("home", "link", "Home", 2),
  node("main", "main", "", 1, ["h2", "form", "frame"]),
  node("h2", "heading", "Billing", 2, [], { properties: { level: "2" } }),
  node("form", "form", "Pay", 2, ["vol", "qty", "box"]),
  node("vol", "slider", "Volume", 3),
  node("qty", "spinbutton", "Quantity", 3),
  node("box", "group", "Extras", 3, ["opt"]),
  node("opt", "checkbox", "Gift wrap", 4),
  node("frame", "Iframe", "Map", 2),
]);

describe("NativeTreeView keyboard and row parity", () => {
  let container: HTMLDivElement;
  let originalScrollIntoView: typeof Element.prototype.scrollIntoView;

  beforeEach(() => {
    originalScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function () {};
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    container.remove();
    Element.prototype.scrollIntoView = originalScrollIntoView;
  });

  function mount(
    options: {
      nodes?: Map<string, NativeNode>;
      onActivate?: ReturnType<typeof vi.fn>;
      onSendKey?: ReturnType<typeof vi.fn>;
      onDialogEscape?: ReturnType<typeof vi.fn>;
      roleFilter?: string;
    } = {},
  ) {
    const onActivate = options.onActivate ?? vi.fn();
    act(() => {
      render(
        <NativeTreeView
          nodes={options.nodes ?? NODES}
          rootId="root"
          busy={false}
          capability={undefined}
          status=""
          onRefresh={() => {}}
          onActivate={onActivate}
          onSendKey={options.onSendKey}
          onDialogEscape={options.onDialogEscape}
        />,
        container,
      );
    });
    return onActivate;
  }

  function row(id: string): HTMLElement {
    const el = container.querySelector<HTMLElement>(`[data-node-id="${id}"]`);
    if (!el) throw new Error(`no row for ${id}`);
    return el;
  }

  function rowIds(): string[] {
    return [
      ...container.querySelectorAll<HTMLElement>('[role="treeitem"]'),
    ].map((r) => r.dataset.nodeId!);
  }

  function selected(): string | undefined {
    return container.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.dataset.nodeId;
  }

  function press(key: string, init: KeyboardEventInit = {}) {
    act(() => {
      container
        .querySelector('[role="tree"]')!
        .dispatchEvent(
          new KeyboardEvent("keydown", { key, bubbles: true, ...init }),
        );
    });
  }

  function select(id: string) {
    act(() => row(id).click());
  }

  it("type-ahead jumps to the next row whose name starts with the key", () => {
    mount();
    select("nav");
    press("m");
    expect(selected()).toBe("main"); // the role, for an unnamed row
  });

  it("type-ahead wraps round past the last row", () => {
    mount();
    select("main");
    press("s");
    expect(selected()).toBe("nav"); // "Site", above it
  });

  it("type-ahead takes a prefix typed in quick succession, and forgets it after a pause", () => {
    // Fake timers: the buffer's reset is a real timeout, and a slow machine
    // must not turn "quick succession" into a pause.
    vi.useFakeTimers();
    try {
      mount();
      select("root");
      press("b");
      expect(selected()).toBe("h2"); // "Billing"
      press("i");
      expect(selected()).toBe("h2"); // "bi" still matches it
      act(() => {
        vi.advanceTimersByTime(1_000);
      });
      press("s");
      expect(selected()).toBe("nav"); // a fresh "s", not "bis"
    } finally {
      vi.useRealTimers();
    }
  });

  it("type-ahead with nothing selected starts from the top", () => {
    mount();
    press("h");
    expect(selected()).toBe("home");
  });

  it("* on the tree's own root does nothing, as in the DOM tree", () => {
    mount();
    const before = rowIds();
    select("root");
    press("*");
    expect(rowIds()).toEqual(before);
  });

  it("* expands every sibling that has children", () => {
    mount();
    expect(rowIds()).not.toContain("vol");
    select("h2");
    press("*");
    // h2's siblings: the form opens, the iframe has nothing to open.
    expect(rowIds()).toContain("vol");
    expect(rowIds()).toContain("box");
  });

  it("Enter steps a slider up and Shift+Enter steps it down", () => {
    const onActivate = mount();
    select("h2");
    press("*"); // opens the form
    select("vol");
    press("Enter");
    press("Enter", { shiftKey: true });
    expect(onActivate.mock.calls.map(([n, a]) => [n.id, a])).toEqual([
      ["vol", "increment"],
      ["vol", "decrement"],
    ]);
  });

  it("Enter on a spinbutton opens its edit box; Shift+Enter steps it down", () => {
    // Enter is the only keyboard way to type a value from the tree, so a
    // spinbutton keeps it rather than stepping like a slider.
    const onActivate = mount();
    select("h2");
    press("*");
    select("qty");
    press("Enter");
    press("Enter", { shiftKey: true });
    expect(onActivate.mock.calls.map(([n, a]) => [n.id, a])).toEqual([
      ["qty", undefined],
      ["qty", "decrement"],
    ]);
  });

  it("+ and - still step", () => {
    const onActivate = mount();
    select("h2");
    press("*");
    select("vol");
    press("+");
    press("-");
    expect(onActivate.mock.calls.map(([, a]) => a)).toEqual([
      "increment",
      "decrement",
    ]);
  });

  it("Enter on a checkbox still clicks it", () => {
    const onActivate = mount();
    select("h2");
    press("*");
    act(() => row("box").click());
    press("ArrowRight");
    select("opt");
    press("Enter");
    expect(onActivate).toHaveBeenCalledWith(NODES.get("opt"), undefined);
  });

  it("shows a heading's level as an H badge, not a level= property", () => {
    mount();
    const heading = row("h2");
    expect(heading.querySelector(".sn-level-badge")?.textContent).toBe("H2");
    expect(heading.textContent).not.toContain("level=");
  });

  it("marks an iframe row as embedded content the tree leaves out", () => {
    mount();
    const badge = row("frame").querySelector(".sn-iframe-badge")!;
    // Visible text "embedded"; the explanation is in the text a screen
    // reader reads too, not only in the tooltip.
    expect(badge.firstChild?.textContent).toBe("embedded");
    expect(badge.querySelector(".sn-sr-only")?.textContent).toContain(
      "doesn't read its contents",
    );
  });

  it("names the arrow keys in the keyboard bar for a screen reader", () => {
    mount({ onSendKey: vi.fn() });
    const names = [
      ...container.querySelectorAll<HTMLButtonElement>(
        ".sn-keyboard-bar .sn-key-btn",
      ),
    ].map((b) => b.getAttribute("aria-label") ?? b.textContent);
    expect(names).toEqual([
      "Esc",
      "Tab",
      "Shift+Tab",
      "Enter",
      "Space",
      "Send Down Arrow",
      "Send Up Arrow",
    ]);
  });

  it("Enter in the role-filter list opens a spinbutton's edit box, as in the tree", () => {
    const onActivate = mount();
    act(() =>
      [...container.querySelectorAll<HTMLButtonElement>(".sn-filter-btn")]
        .find((b) => b.textContent === "Forms")!
        .click(),
    );
    const list = container.querySelector<HTMLElement>('[role="listbox"]')!;
    const options = [...list.querySelectorAll<HTMLElement>('[role="option"]')];
    const qty = options.findIndex((o) => o.textContent?.includes("Quantity"));
    expect(qty).toBeGreaterThanOrEqual(0);
    act(() => options[qty]!.click());
    act(() => {
      list.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(onActivate).toHaveBeenLastCalledWith(NODES.get("qty"), undefined);
  });

  it("names double-click scope in its hints", () => {
    mount();
    expect(container.querySelector(".sn-hints")?.textContent).toContain(
      "DblClick scope",
    );
  });

  it("shows the keyboard bar only when it can send keys, and sends them", () => {
    mount();
    expect(container.querySelector(".sn-keyboard-bar")).toBeNull();

    const onSendKey = vi.fn();
    mount({ onSendKey });
    const tab = [
      ...container.querySelectorAll<HTMLButtonElement>(
        ".sn-keyboard-bar .sn-key-btn",
      ),
    ].find((b) => b.textContent === "Shift+Tab")!;
    act(() => tab.click());
    expect(onSendKey).toHaveBeenCalledWith("Tab", "Tab", 9, { shift: true });
  });

  it("shows the dialog indicator for a modal dialog, and Press ESC asks to close it", () => {
    const onDialogEscape = vi.fn();
    const withDialog = new Map(NODES);
    withDialog.set("root", { ...NODES.get("root")!, childIds: ["nav", "dlg"] });
    withDialog.set(
      "dlg",
      node("dlg", "dialog", "Confirm payment", 1, [], {
        states: { modal: true },
      })[1],
    );
    mount({ nodes: withDialog, onDialogEscape });

    const indicator = container.querySelector(".sn-dialog-indicator");
    expect(indicator?.textContent).toContain("Dialog: Confirm payment");
    act(() =>
      indicator!.querySelector<HTMLButtonElement>(".sn-key-btn")!.click(),
    );
    expect(onDialogEscape).toHaveBeenCalledWith("dlg");
  });

  it("keeps the indicator's live region mounted while no dialog is open", () => {
    // A live region that arrives already holding its text is not announced
    // by most screen readers, so the region waits, empty, for the dialog.
    mount({ onDialogEscape: vi.fn() });
    expect(container.querySelector(".sn-dialog-indicator")).toBeNull();
    const regions = [...container.querySelectorAll('[role="status"]')];
    expect(regions.some((r) => r.textContent === "")).toBe(true);
  });
});
