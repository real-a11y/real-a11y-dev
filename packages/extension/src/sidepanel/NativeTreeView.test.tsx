import { render } from "preact";
import { act } from "preact/test-utils";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import type { NativeNode } from "../native/native-actions.js";

import {
  NATIVE_FOLLOW_DEBOUNCE_MS,
  NATIVE_HOVER_DWELL_MS,
} from "./native-follow.js";
import { NativeTreeView } from "./NativeTreeView.js";

/**
 * The native producer's role filter shows the same flat list the DOM
 * producer's does (`FilteredList`), not a filtered tree.
 */

function node(
  id: string,
  role: string,
  name: string,
  depth: number,
  childIds: string[] = [],
  properties: Record<string, string> = {},
): [string, NativeNode] {
  return [id, { id, role, name, depth, childIds, states: {}, properties }];
}

// Map order deliberately differs from document order: the list must follow
// the tree, not the map.
const NODES = new Map<string, NativeNode>([
  node("root", "document", "", 0, ["main", "footer"]),
  node("footer", "contentinfo", "", 1, ["h-foot"]),
  node("h-foot", "heading", "Footer", 2, [], { level: "2" }),
  node("main", "main", "", 1, ["h1", "sec", "link"]),
  node("h1", "heading", "Overview", 2, [], { level: "1" }),
  node("sec", "region", "Details", 2, ["h3"]),
  node("h3", "heading", "Deep", 3, [], { level: "3" }),
  node("link", "link", "Docs", 2),
]);

describe("NativeTreeView role filter", () => {
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

  function mount(onActivate = vi.fn()) {
    act(() => {
      render(
        <NativeTreeView
          nodes={NODES}
          rootId="root"
          busy={false}
          capability={undefined}
          status=""
          onRefresh={() => {}}
          onActivate={onActivate}
        />,
        container,
      );
    });
    return onActivate;
  }

  function pill(label: string): HTMLButtonElement {
    const btn = [
      ...container.querySelectorAll<HTMLButtonElement>(".sn-filter-btn"),
    ].find((b) => b.textContent === label);
    if (!btn) throw new Error(`no ${label} pill`);
    return btn;
  }

  function options(): HTMLElement[] {
    return [...container.querySelectorAll<HTMLElement>('[role="option"]')];
  }

  function listbox(): HTMLElement {
    const el = container.querySelector<HTMLElement>('[role="listbox"]');
    if (!el) throw new Error("no listbox rendered");
    return el;
  }

  it("swaps the tree for a flat list of matches in document order", () => {
    mount();
    expect(container.querySelector('[role="tree"]')).not.toBeNull();

    act(() => pill("Headings").click());

    expect(container.querySelector('[role="tree"]')).toBeNull();
    expect(options().map((o) => o.textContent)).toEqual([
      "H1Overview",
      "H3Deep",
      "H2Footer",
    ]);
    expect(container.querySelector(".sn-list-count")?.textContent).toBe(
      "3 items",
    );
    // Mounted without `onSelectionReveal`, so there is no page follow and no
    // "Move to" that would do nothing.
    const buttons = [...container.querySelectorAll(".sn-list-action-btn")].map(
      (b) => b.textContent,
    );
    expect(buttons).toEqual(["Activate"]);
  });

  it("narrows the list with the search query", () => {
    mount();
    act(() => pill("Headings").click());
    const search = container.querySelector<HTMLInputElement>(".sn-search")!;
    act(() => {
      search.value = "dee";
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(options().map((o) => o.textContent)).toEqual(["H3Deep"]);
  });

  it("leaves a double-click on a row's expander to the expander", () => {
    // The browser fires two clicks and then a dblclick; the clicks already
    // toggled the row, so the dblclick must not act on the row as well. An
    // actionable row with children: its row double-click activates it.
    const onActivate = vi.fn();
    act(() => {
      render(
        <NativeTreeView
          nodes={
            new Map<string, NativeNode>([
              node("root", "document", "", 0, ["menu"]),
              node("menu", "button", "Menu", 1, ["item"]),
              node("item", "menuitem", "Open", 2),
            ])
          }
          rootId="root"
          busy={false}
          capability={undefined}
          status=""
          onRefresh={() => {}}
          onActivate={onActivate}
        />,
        container,
      );
    });
    const row = [
      ...container.querySelectorAll<HTMLElement>('[role="treeitem"]'),
    ].find((r) => r.textContent?.includes("Menu"))!;
    const before = row.getAttribute("aria-expanded");
    act(() => {
      row
        .querySelector(".sn-toggle")!
        .dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(onActivate).not.toHaveBeenCalled();
    expect(row.getAttribute("aria-expanded")).toBe(before);
  });

  it("activates a link through the native onActivate", () => {
    const onActivate = mount();
    act(() => pill("Links").click());
    expect(options().map((o) => o.textContent)).toEqual(["Docs"]);

    act(() => {
      listbox().dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(onActivate).toHaveBeenCalledWith(NODES.get("link"), undefined);
  });

  it("steps a slider on Enter rather than clicking it", () => {
    const slider = node("vol", "slider", "Volume", 1);
    const nodes = new Map<string, NativeNode>([
      node("root", "document", "", 0, ["vol"]),
      slider,
    ]);
    const onActivate = vi.fn();
    act(() => {
      render(
        <NativeTreeView
          nodes={nodes}
          rootId="root"
          busy={false}
          capability={undefined}
          status=""
          onRefresh={() => {}}
          onActivate={onActivate}
        />,
        container,
      );
    });
    act(() => pill("Forms").click());
    act(() => {
      listbox().dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(onActivate).toHaveBeenCalledWith(slider[1], "increment");
  });

  it("opens a listbox's tree row on Enter, since it has no action to run", () => {
    const nodes = new Map<string, NativeNode>([
      node("root", "document", "", 0, ["lb"]),
      node("lb", "listbox", "Colors", 1, ["opt"]),
      node("opt", "option", "Red", 2),
    ]);
    const onActivate = vi.fn();
    act(() => {
      render(
        <NativeTreeView
          nodes={nodes}
          rootId="root"
          busy={false}
          capability={undefined}
          status=""
          onRefresh={() => {}}
          onActivate={onActivate}
        />,
        container,
      );
    });
    act(() => pill("Forms").click());
    expect(options().map((o) => o.textContent)).toEqual(["Colors"]);
    act(() => {
      listbox().dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(onActivate).not.toHaveBeenCalled();
    expect(container.querySelector('[role="tree"]')).not.toBeNull();
    const selected = container.querySelector('[aria-selected="true"]');
    expect(selected?.getAttribute("data-node-id")).toBe("lb");
  });

  it("goes back to the tree on Enter over a heading, with the heading selected", () => {
    mount();
    act(() => pill("Headings").click());
    act(() => {
      listbox().dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });
    act(() => {
      listbox().dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });

    expect(container.querySelector('[role="listbox"]')).toBeNull();
    expect(pill("Headings").getAttribute("aria-pressed")).toBe("false");
    // "Deep" sits under a collapsed region; going to it must open the way.
    const selected = container.querySelector('[aria-selected="true"]');
    expect(selected?.getAttribute("data-node-id")).toBe("h3");
  });
});

describe("NativeTreeView selection-focus follow", () => {
  let container: HTMLDivElement;
  let originalScrollIntoView: typeof Element.prototype.scrollIntoView;

  beforeEach(() => {
    vi.useFakeTimers();
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

  function mountWithRevealFollow(onSelectionReveal = vi.fn()) {
    act(() => {
      render(
        <NativeTreeView
          nodes={NODES}
          rootId="root"
          busy={false}
          capability={undefined}
          status=""
          onRefresh={() => {}}
          onActivate={() => {}}
          onSelectionReveal={onSelectionReveal}
        />,
        container,
      );
    });
    return onSelectionReveal;
  }

  function row(id: string): HTMLElement {
    const el = container.querySelector<HTMLElement>(`[data-node-id="${id}"]`);
    if (!el) throw new Error(`no row for ${id}`);
    return el;
  }

  it("calls onSelectionReveal with the clicked row's id, after a debounce", () => {
    const onSelectionReveal = mountWithRevealFollow();
    act(() => row("h1").click());

    expect(onSelectionReveal).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(NATIVE_FOLLOW_DEBOUNCE_MS);
    });
    expect(onSelectionReveal).toHaveBeenCalledExactlyOnceWith("h1");
  });

  it("only fires once for the row the selection settles on, not every intermediate one", () => {
    const onSelectionReveal = mountWithRevealFollow();
    act(() => row("h1").click());
    act(() => {
      vi.advanceTimersByTime(50);
    });
    act(() => row("link").click());
    act(() => {
      vi.advanceTimersByTime(50);
    });
    act(() => row("h-foot").click());
    act(() => {
      vi.advanceTimersByTime(NATIVE_FOLLOW_DEBOUNCE_MS);
    });

    expect(onSelectionReveal).toHaveBeenCalledExactlyOnceWith("h-foot");
  });

  it("does not re-fire for the same selection when only the callback's identity changes", () => {
    // A host's callback may change identity whenever its own state flips
    // (App.tsx's once depended on nativeBusy/curtainOn; `useNativeOverlay`'s
    // is stable now) even though the tree's own selection didn't move — e.g.
    // a native action settling after dispatch.
    // The effect used to list the callback itself as a dependency, so a
    // fresh reference re-armed the debounce for the SAME row and fired a
    // second, unwanted dispatch — concretely, stealing focus back from a
    // dialog an action had just opened, once nativeBusy cleared.
    const first = vi.fn();
    act(() => {
      render(
        <NativeTreeView
          nodes={NODES}
          rootId="root"
          busy={false}
          capability={undefined}
          status=""
          onRefresh={() => {}}
          onActivate={() => {}}
          onSelectionReveal={first}
        />,
        container,
      );
    });
    act(() => row("h1").click());
    act(() => {
      vi.advanceTimersByTime(NATIVE_FOLLOW_DEBOUNCE_MS);
    });
    expect(first).toHaveBeenCalledExactlyOnceWith("h1");

    // Re-render with a NEW callback reference, with the selection itself
    // untouched.
    const second = vi.fn();
    act(() => {
      render(
        <NativeTreeView
          nodes={NODES}
          rootId="root"
          busy={false}
          capability={undefined}
          status=""
          onRefresh={() => {}}
          onActivate={() => {}}
          onSelectionReveal={second}
        />,
        container,
      );
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(second).not.toHaveBeenCalled();
    expect(first).toHaveBeenCalledTimes(1);
  });

  it("re-fires when a click re-selects the row that's already selected", () => {
    // Page focus may have moved elsewhere since the first follow; clicking
    // the same row again is an explicit request to go back to it — the DOM
    // tree's own `handleSelect` re-highlights on every click, same row or not.
    const onSelectionReveal = mountWithRevealFollow();
    act(() => row("h1").click());
    act(() => {
      vi.advanceTimersByTime(NATIVE_FOLLOW_DEBOUNCE_MS);
    });
    act(() => row("h1").click());
    act(() => {
      vi.advanceTimersByTime(NATIVE_FOLLOW_DEBOUNCE_MS);
    });
    expect(onSelectionReveal).toHaveBeenCalledTimes(2);
    expect(onSelectionReveal).toHaveBeenLastCalledWith("h1");
  });

  it("re-fires when a pick reveals the row that's already selected", () => {
    // `selectedId` doesn't change
    // for a repeat pick of the selected row, so keying on it alone skipped
    // the follow and left page focus wherever it had moved in between.
    const onSelectionReveal = vi.fn();
    const mountWith = (nonce: number) =>
      act(() => {
        render(
          <NativeTreeView
            nodes={NODES}
            rootId="root"
            busy={false}
            capability={undefined}
            status=""
            onRefresh={() => {}}
            onActivate={() => {}}
            onSelectionReveal={onSelectionReveal}
            reveal={{ nodeId: "link", nonce }}
          />,
          container,
        );
      });
    mountWith(1);
    act(() => {
      vi.advanceTimersByTime(NATIVE_FOLLOW_DEBOUNCE_MS);
    });
    mountWith(2);
    act(() => {
      vi.advanceTimersByTime(NATIVE_FOLLOW_DEBOUNCE_MS);
    });
    expect(onSelectionReveal).toHaveBeenCalledTimes(2);
    expect(onSelectionReveal).toHaveBeenLastCalledWith("link");
  });

  it("never calls onSelectionReveal when nothing is selected", () => {
    const onSelectionReveal = mountWithRevealFollow();
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(onSelectionReveal).not.toHaveBeenCalled();
  });

  it("does not throw when onSelectionReveal is omitted", () => {
    act(() => {
      render(
        <NativeTreeView
          nodes={NODES}
          rootId="root"
          busy={false}
          capability={undefined}
          status=""
          onRefresh={() => {}}
          onActivate={() => {}}
        />,
        container,
      );
    });
    expect(() => {
      act(() => row("h1").click());
      act(() => {
        vi.advanceTimersByTime(500);
      });
    }).not.toThrow();
  });

  describe("in the role-filter list", () => {
    function pill(label: string): HTMLButtonElement {
      const btn = [
        ...container.querySelectorAll<HTMLButtonElement>(".sn-filter-btn"),
      ].find((b) => b.textContent === label);
      if (!btn) throw new Error(`no ${label} pill`);
      return btn;
    }

    function option(label: string): HTMLElement {
      const el = [
        ...container.querySelectorAll<HTMLElement>('[role="option"]'),
      ].find((o) => o.textContent?.includes(label));
      if (!el) throw new Error(`no option ${label}`);
      return el;
    }

    function listbox(): HTMLElement {
      return container.querySelector<HTMLElement>('[role="listbox"]')!;
    }

    it("follows a clicked list item onto the page, after the same debounce", () => {
      // The follow only watched the
      // tree's own `selectedId`, and the flat list keeps its selection to
      // itself, so a filter being on silently turned the page indicator off.
      const onSelectionReveal = mountWithRevealFollow();
      act(() => pill("Headings").click());
      act(() => option("Deep").click());

      expect(onSelectionReveal).not.toHaveBeenCalled();
      act(() => {
        vi.advanceTimersByTime(NATIVE_FOLLOW_DEBOUNCE_MS);
      });
      expect(onSelectionReveal).toHaveBeenCalledExactlyOnceWith("h3");
    });

    it("follows the item arrow keys settle on, not every one they pass", () => {
      const onSelectionReveal = mountWithRevealFollow();
      act(() => pill("Headings").click());
      act(() => {
        listbox().dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
        );
      });
      act(() => {
        listbox().dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
        );
      });
      act(() => {
        vi.advanceTimersByTime(NATIVE_FOLLOW_DEBOUNCE_MS);
      });
      expect(onSelectionReveal).toHaveBeenCalledExactlyOnceWith("h-foot");
    });

    it("offers Move to, which re-follows the selected item", () => {
      const onSelectionReveal = mountWithRevealFollow();
      act(() => pill("Headings").click());
      act(() => option("Overview").click());
      act(() => {
        vi.advanceTimersByTime(NATIVE_FOLLOW_DEBOUNCE_MS);
      });

      const moveTo = [
        ...container.querySelectorAll<HTMLButtonElement>(".sn-list-action-btn"),
      ].find((b) => b.textContent === "Move to");
      expect(moveTo).toBeDefined();
      act(() => moveTo!.click());
      act(() => {
        vi.advanceTimersByTime(NATIVE_FOLLOW_DEBOUNCE_MS);
      });
      expect(onSelectionReveal).toHaveBeenCalledTimes(2);
      expect(onSelectionReveal).toHaveBeenLastCalledWith("h1");
    });

    it("does not follow anything just for turning a filter on", () => {
      const onSelectionReveal = mountWithRevealFollow();
      act(() => pill("Headings").click());
      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(onSelectionReveal).not.toHaveBeenCalled();
    });

    it("drops a pending list follow on unmount", () => {
      const onSelectionReveal = mountWithRevealFollow();
      act(() => pill("Headings").click());
      act(() => option("Deep").click());
      act(() => render(null, container));
      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(onSelectionReveal).not.toHaveBeenCalled();
    });
  });
});

describe("NativeTreeView hover preview", () => {
  let container: HTMLDivElement;
  let originalScrollIntoView: typeof Element.prototype.scrollIntoView;

  beforeEach(() => {
    vi.useFakeTimers();
    originalScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function () {};
    container = document.createElement("div");
    document.body.appendChild(container);
    // Input modality is process-wide; start each test from the mouse.
    window.dispatchEvent(new MouseEvent("mousemove"));
  });

  afterEach(() => {
    render(null, container);
    container.remove();
    Element.prototype.scrollIntoView = originalScrollIntoView;
    vi.useRealTimers();
  });

  function mount(onHoverPreview = vi.fn()) {
    act(() => {
      render(
        <NativeTreeView
          nodes={NODES}
          rootId="root"
          busy={false}
          capability={undefined}
          status=""
          onRefresh={() => {}}
          onActivate={() => {}}
          onHoverPreview={onHoverPreview}
        />,
        container,
      );
    });
    return onHoverPreview;
  }

  function row(id: string): HTMLElement {
    const el = container.querySelector<HTMLElement>(`[data-node-id="${id}"]`);
    if (!el) throw new Error(`no row for ${id}`);
    return el;
  }

  const enter = (id: string) =>
    act(() => {
      row(id).dispatchEvent(new MouseEvent("mouseenter"));
    });
  const leave = (id: string) =>
    act(() => {
      row(id).dispatchEvent(new MouseEvent("mouseleave"));
    });
  const wait = (ms: number) =>
    act(() => {
      vi.advanceTimersByTime(ms);
    });

  it("previews the row the pointer settles on, once", () => {
    const onHoverPreview = mount();
    enter("h1");
    expect(onHoverPreview).not.toHaveBeenCalled();
    wait(NATIVE_HOVER_DWELL_MS);
    expect(onHoverPreview).toHaveBeenCalledExactlyOnceWith("h1");
  });

  it("skips the rows a sweep only crosses", () => {
    const onHoverPreview = mount();
    enter("h1");
    wait(50);
    leave("h1");
    enter("sec");
    wait(50);
    leave("sec");
    enter("link");
    wait(NATIVE_HOVER_DWELL_MS);
    // Nothing was shown on the crossed rows, so nothing to clear either.
    expect(onHoverPreview.mock.calls).toEqual([["link"]]);
  });

  it("clears at once on leaving an outlined row", () => {
    const onHoverPreview = mount();
    enter("h1");
    wait(NATIVE_HOVER_DWELL_MS);
    leave("h1");
    expect(onHoverPreview.mock.calls).toEqual([["h1"], [null]]);
  });

  it("clears a clicked row's outline when the pointer leaves before the dwell", () => {
    // The click's reveal is sent at once rather than after the debounce, so
    // the clear follows it, as leaving a clicked row does in the DOM tree.
    const calls: Array<[string, string | null]> = [];
    act(() => {
      render(
        <NativeTreeView
          nodes={NODES}
          rootId="root"
          busy={false}
          capability={undefined}
          status=""
          onRefresh={() => {}}
          onActivate={() => {}}
          onHoverPreview={(id) => calls.push(["preview", id])}
          onSelectionReveal={(id) => calls.push(["reveal", id])}
        />,
        container,
      );
    });
    enter("h1");
    act(() => row("h1").click());
    wait(50);
    leave("h1");
    wait(500);
    expect(calls).toEqual([
      ["reveal", "h1"],
      ["preview", null],
    ]);
  });

  it("clears a clicked row's outline when the pointer leaves before the click's reveal is scheduled", () => {
    // The reveal is scheduled by an effect, after paint: a pointer that
    // leaves within that frame finds nothing pending to send.
    const calls: Array<[string, string | null]> = [];
    act(() => {
      render(
        <NativeTreeView
          nodes={NODES}
          rootId="root"
          busy={false}
          capability={undefined}
          status=""
          onRefresh={() => {}}
          onActivate={() => {}}
          onHoverPreview={(id) => calls.push(["preview", id])}
          onSelectionReveal={(id) => calls.push(["reveal", id])}
        />,
        container,
      );
    });
    enter("h1");
    act(() => {
      row("h1").click();
      row("h1").dispatchEvent(new MouseEvent("mouseleave"));
    });
    wait(500);
    // The last word on the page is a clear that follows the reveal.
    expect(calls.slice(-2)).toEqual([
      ["reveal", "h1"],
      ["preview", null],
    ]);
  });

  it("keeps the next keyboard selection's outline after a clicked row's reveal went and the pointer left", () => {
    const calls: Array<[string, string | null]> = [];
    act(() => {
      render(
        <NativeTreeView
          nodes={NODES}
          rootId="root"
          busy={false}
          capability={undefined}
          status=""
          onRefresh={() => {}}
          onActivate={() => {}}
          onHoverPreview={(id) => calls.push(["preview", id])}
          onSelectionReveal={(id) => calls.push(["reveal", id])}
        />,
        container,
      );
    });
    enter("h1");
    act(() => row("h1").click());
    wait(500); // the click's reveal has gone
    leave("h1");
    calls.length = 0;
    act(() => {
      container
        .querySelector<HTMLElement>(".sn-tree")!
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
        );
    });
    wait(500);
    // The keyboard's reveal, and no clear after it.
    expect(calls).toEqual([["reveal", expect.any(String)]]);
  });

  it("leaves no preview to land after leaving a row early", () => {
    const onHoverPreview = mount();
    enter("h1");
    leave("h1");
    wait(500);
    expect(onHoverPreview).not.toHaveBeenCalled();
  });

  it("clears an outlined row that keyboard scrolling moves away from the pointer", () => {
    // The keyboard took over, so a row moving under the pointer is no new
    // hover, but the row that was outlined is still left.
    const onHoverPreview = mount();
    enter("h1");
    wait(NATIVE_HOVER_DWELL_MS);
    const tree = container.querySelector<HTMLElement>('[role="tree"]')!;
    act(() => {
      tree.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });
    leave("h1");
    enter("link");
    wait(500);
    expect(onHoverPreview.mock.calls).toEqual([["h1"], [null]]);
  });

  it("clears an outlined row that a re-read drops, with no mouseleave", () => {
    const onHoverPreview = mount();
    enter("link");
    wait(NATIVE_HOVER_DWELL_MS);
    const without = new Map(NODES);
    without.delete("link");
    without.set("main", { ...NODES.get("main")!, childIds: ["h1", "sec"] });
    act(() => {
      render(
        <NativeTreeView
          nodes={without}
          rootId="root"
          busy={false}
          capability={undefined}
          status=""
          onRefresh={() => {}}
          onActivate={() => {}}
          onHoverPreview={onHoverPreview}
        />,
        container,
      );
    });
    expect(onHoverPreview.mock.calls).toEqual([["link"], [null]]);
  });

  it("ignores a row that keyboard scrolling moves under a still pointer", () => {
    const onHoverPreview = mount();
    act(() => row("h1").click());
    const tree = container.querySelector<HTMLElement>('[role="tree"]')!;
    act(() => {
      tree.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });
    enter("link");
    wait(500);
    expect(onHoverPreview).not.toHaveBeenCalled();
  });

  it("clears a shown outline when a role filter's list replaces the rows", () => {
    // The row goes away under a still pointer, so it gets no mouseleave.
    const onHoverPreview = mount();
    enter("h1");
    wait(NATIVE_HOVER_DWELL_MS);
    const headings = [
      ...container.querySelectorAll<HTMLButtonElement>(".sn-filter-btn"),
    ].find((b) => b.textContent === "Headings")!;
    act(() => headings.click());
    expect(onHoverPreview.mock.calls).toEqual([["h1"], [null]]);
  });

  it("clears a shown outline when the tree unmounts, and nothing else", () => {
    const shown = mount();
    enter("h1");
    wait(NATIVE_HOVER_DWELL_MS);
    act(() => render(null, container));
    expect(shown.mock.calls).toEqual([["h1"], [null]]);

    // A hover still waiting had nothing on the page to clear.
    const waiting = mount();
    enter("h1");
    act(() => render(null, container));
    wait(500);
    expect(waiting).not.toHaveBeenCalled();
  });

  it("drops a pending preview when the keyboard takes over", () => {
    const onHoverPreview = mount();
    enter("h1");
    wait(50);
    const tree = container.querySelector<HTMLElement>('[role="tree"]')!;
    act(() => {
      tree.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });
    wait(500);
    expect(onHoverPreview).not.toHaveBeenCalled();
  });
});
