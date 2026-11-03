import { render } from "preact";
import { act } from "preact/test-utils";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { FilteredListView, type FilteredListItem } from "./FilteredList.js";

/**
 * The panel's role-filtered list view — the heading outline, the link list, the
 * form-control list. Chrome's tree maps its matches onto `FilteredListItem`s
 * (`NativeTreeView.tsx`) and the list renders them. Written in JSX rather than
 * `h()` calls because the props are the interesting part of each case and JSX
 * keeps them readable.
 */

function item(id: string, label: string, level?: number): FilteredListItem {
  return { id, label, level, states: [], actions: [] };
}

const HEADINGS: FilteredListItem[] = [
  item("h1", "Overview", 1),
  item("h2", "Install", 2),
  item("h3", "Troubleshooting", 3),
];

describe("FilteredListView", () => {
  let container: HTMLDivElement;
  let originalScrollIntoView: typeof Element.prototype.scrollIntoView;

  beforeEach(() => {
    // jsdom does not implement scrollIntoView; stub so the
    // keep-the-selected-option-visible effect can run.
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

  function options(): HTMLElement[] {
    return [...container.querySelectorAll('[role="option"]')] as HTMLElement[];
  }

  function listbox(): HTMLElement {
    const el = container.querySelector('[role="listbox"]');
    if (!el) throw new Error("no listbox rendered");
    return el as HTMLElement;
  }

  function noop() {}

  function show(
    props: Partial<Parameters<typeof FilteredListView>[0]> = {},
  ): void {
    act(() => {
      render(
        <FilteredListView
          items={HEADINGS}
          roleFilter="heading"
          query=""
          onHighlight={noop}
          onActivate={noop}
          onGoToTree={noop}
          {...props}
        />,
        container,
      );
    });
  }

  it("offers Move to only where the page can be highlighted", () => {
    const buttons = () =>
      [...container.querySelectorAll(".sn-list-action-btn")].map(
        (b) => b.textContent,
      );
    show();
    expect(buttons()).toEqual(["Activate", "Move to"]);
    show({ onHighlight: undefined });
    expect(buttons()).toEqual(["Activate"]);
  });

  describe("a scope change with the list showing", () => {
    // `h2` and `h3` sit under the scope; `h1` is outside it.
    const inScope = HEADINGS.slice(1);

    function selectedLabel(): string | null | undefined {
      return container.querySelector('[role="option"][aria-selected="true"]')
        ?.textContent;
    }

    it("keeps the selected item when leaving the scope adds matches ahead of it", () => {
      // Regression (Devin Review): the list kept its index, so leaving the
      // scope moved the selection from Troubleshooting to Install, and
      // Enter would have acted on a row nobody picked.
      show({ items: inScope, scopeRootId: "section" });
      act(() => {
        listbox().dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
        );
      });
      expect(selectedLabel()).toBe("H3Troubleshooting");

      show({ items: HEADINGS, scopeRootId: null });
      expect(options()).toHaveLength(3);
      expect(selectedLabel()).toBe("H3Troubleshooting");
    });

    it("falls back to the first item when the selected one leaves the scope", () => {
      show({ scopeRootId: null }); // Overview is selected
      show({ items: inScope, scopeRootId: "section" });
      expect(selectedLabel()).toBe("H2Install");
    });
  });

  it("says a scoped list is empty in this scope", () => {
    show({ items: [], scopeRootId: "p1" });
    expect(container.querySelector(".sn-empty")?.textContent).toBe(
      "No headings found in this scope",
    );
  });

  it("lists its items with heading levels", () => {
    show();
    expect(options().map((el) => el.textContent)).toEqual([
      "H1Overview",
      "H2Install",
      "H3Troubleshooting",
    ]);
    expect(container.textContent).toContain("3 items");

    // Level drives the indent, so the outline reads as a hierarchy.
    const indents = options().map((el) => el.style.paddingLeft);
    expect(indents).toEqual(["", "24px", "40px"]);
  });

  it("moves the selection with ArrowDown and reports each highlight", () => {
    const highlighted: string[] = [];
    show({ onHighlight: (id) => highlighted.push(id) });

    expect(options()[0]?.getAttribute("aria-selected")).toBe("true");

    act(() => {
      listbox().dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });

    expect(options()[1]?.getAttribute("aria-selected")).toBe("true");
    expect(highlighted).toEqual(["h2"]);
    // The rows never hold DOM focus, so the active option is announced through
    // aria-activedescendant on the container instead.
    expect(listbox().getAttribute("aria-activedescendant")).toBe(
      "sn-filtered-opt-1",
    );

    // End jumps to the last match rather than walking off it.
    act(() => {
      listbox().dispatchEvent(
        new KeyboardEvent("keydown", { key: "End", bubbles: true }),
      );
    });
    expect(options()[2]?.getAttribute("aria-selected")).toBe("true");
    expect(highlighted).toEqual(["h2", "h3"]);
  });

  it("says what the search left nothing of", () => {
    show({ items: [], query: "nothing here" });
    expect(options()).toHaveLength(0);
    expect(container.textContent).toContain(
      'No headings found matching "nothing here"',
    );
  });

  it("gives a name its whole text as a tooltip, and shows it whole with Show full names", () => {
    const long = "A heading whose text runs on far past the width of a panel";
    show({ items: [item("h1", long, 1)] });
    expect(
      container.querySelector(".sn-filtered-name")?.getAttribute("title"),
    ).toBe(long);
    expect(listbox().classList.contains("sn-filtered-list--full-names")).toBe(
      false,
    );
    show({ items: [item("h1", long, 1)], showFullNames: true });
    expect(listbox().classList.contains("sn-filtered-list--full-names")).toBe(
      true,
    );
  });
});
