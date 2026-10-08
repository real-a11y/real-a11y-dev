import { render } from "preact";
import { useState } from "preact/hooks";
import { act } from "preact/test-utils";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import type { NativeNode } from "../native/native-actions.js";

import { NativeTreeView } from "./NativeTreeView.js";

/**
 * `aria-controls` jump chips in the native tree: a row lists the rows it
 * controls, a controlled row lists the rows that control it, and a chip
 * selects its target even when that sits under a collapsed row, outside the
 * scope, or behind a search.
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

// The tabs sit in a tablist; the panel they control sits in a section beside
// it that starts collapsed (only the root and its children open on mount).
const NODES = new Map<string, NativeNode>([
  node("root", "document", "", 0, ["list", "panels"]),
  node("list", "tablist", "Artists", 1, ["tab1", "tab2"]),
  node("tab1", "tab", "Nils Frahm", 2, [], { controls: ["panel1"] }),
  node("tab2", "tab", "A tab whose name is far too long to show", 2, [], {
    controls: ["gone", "panel1"],
  }),
  node("panels", "group", "Panels", 1, ["section"]),
  node("section", "region", "Artist pages", 2, ["panel1"]),
  node("panel1", "tabpanel", "Nils Frahm", 3),
]);

describe("NativeTreeView aria-controls jump chips", () => {
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
    vi.useRealTimers();
  });

  function mount(initialScope: string | null = null) {
    const scopes: Array<string | null> = [];
    function Host() {
      const [scope, setScope] = useState<string | null>(initialScope);
      return (
        <NativeTreeView
          nodes={NODES}
          rootId="root"
          busy={false}
          capability={undefined}
          status=""
          onRefresh={() => {}}
          onActivate={() => {}}
          scopedRootId={scope}
          onScope={(id) => {
            scopes.push(id);
            setScope(id);
          }}
        />
      );
    }
    act(() => {
      render(<Host />, container);
    });
    return scopes;
  }

  function row(id: string): HTMLElement {
    const el = container.querySelector<HTMLElement>(`[data-node-id="${id}"]`);
    if (!el) throw new Error(`no row for ${id}`);
    return el;
  }

  function chips(id: string): HTMLButtonElement[] {
    return [
      ...row(id).querySelectorAll<HTMLButtonElement>(".sn-controls-link"),
    ];
  }

  function selected(): string | undefined {
    return container.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.dataset.nodeId;
  }

  function expand(id: string) {
    act(() => {
      row(id).querySelector<HTMLButtonElement>(".sn-toggle")!.click();
    });
  }

  it("shows a chip to each row a node controls, named like the DOM tree's", () => {
    mount();
    const [chip] = chips("tab1");
    expect(chip.textContent).toBe('→ tabpanel "Nils Frahm"');
    expect(chip.title).toBe(
      "Jump to the tabpanel this element controls (Alt+J)",
    );
  });

  it("skips a target the tree doesn't have", () => {
    mount();
    // tab2 controls "gone" and panel1: only panel1 has a row.
    expect(chips("tab2").map((c) => c.textContent)).toEqual([
      '→ tabpanel "Nils Frahm"',
    ]);
  });

  it("selects the target, opening the collapsed rows above it, and flashes it", () => {
    vi.useFakeTimers();
    mount();
    // The panel's section starts collapsed, so its row isn't rendered.
    expect(container.querySelector('[data-node-id="panel1"]')).toBeNull();

    act(() => chips("tab1")[0]!.click());
    expect(selected()).toBe("panel1");
    expect(row("panel1").classList).toContain("sn-node--flash");

    act(() => {
      vi.advanceTimersByTime(700);
    });
    expect(row("panel1").classList).not.toContain("sn-node--flash");
  });

  it("lists the rows that control a node, and jumps back to them", () => {
    mount();
    expand("section");
    const back = chips("panel1");
    // Truncated at 24 characters, as the DOM tree's chip is.
    expect(back.map((c) => c.textContent)).toEqual([
      '← tab "Nils Frahm"',
      '← tab "A tab whose name is far …"',
    ]);
    expect(back[0]!.title).toBe(
      "Jump to the tab that controls this element (Alt+Shift+J)",
    );
    expect(back[0]!.classList).toContain("sn-controls-link--reverse");

    act(() => back[1]!.click());
    expect(selected()).toBe("tab2");
  });

  function press(key: string, init: KeyboardEventInit = {}) {
    act(() => {
      container
        .querySelector('[role="tree"]')!
        .dispatchEvent(
          new KeyboardEvent("keydown", { key, bubbles: true, ...init }),
        );
    });
  }

  it("Alt+J follows the selected row's link, and Alt+Shift+J comes back", () => {
    mount();
    act(() => row("tab1").click());
    // Option+J types a symbol on a Mac, so the key is matched on its code.
    press("∆", { code: "KeyJ", altKey: true });
    expect(selected()).toBe("panel1");
    expect(row("panel1").classList).toContain("sn-node--flash");

    press("J", { code: "KeyJ", altKey: true, shiftKey: true });
    expect(selected()).toBe("tab1");
  });

  it("Alt+J does nothing on a row with no link, and never types ahead", () => {
    mount();
    act(() => row("list").click());
    press("j", { code: "KeyJ", altKey: true });
    expect(selected()).toBe("list");
  });

  it("leaves a scope the target sits outside of", () => {
    const scopes = mount("list");
    act(() => chips("tab1")[0]!.click());
    expect(scopes).toEqual([null]);
    expect(selected()).toBe("panel1");
  });

  it("keeps the scope when the target is inside it", () => {
    const scopes = mount("root");
    act(() => chips("tab1")[0]!.click());
    expect(scopes).toEqual([]);
    expect(selected()).toBe("panel1");
  });

  it("clears a search that would hide the target", () => {
    mount();
    const search = container.querySelector<HTMLInputElement>(
      'input[type="search"], .sn-search-input',
    );
    expect(search).not.toBeNull();
    act(() => {
      search!.value = "tab";
      search!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => chips("tab1")[0]!.click());
    expect(search!.value).toBe("");
    expect(selected()).toBe("panel1");
  });

  it("doesn't select the row a chip sits on", () => {
    mount();
    act(() => chips("tab1")[0]!.click());
    expect(selected()).not.toBe("tab1");
  });
});
