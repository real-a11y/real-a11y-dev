import type { SemanticNode } from "@real-a11y-dev/core";
import { render } from "preact";
import { act } from "preact/test-utils";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { FilteredList } from "./FilteredList.js";

/**
 * Minimal valid `SemanticNode` for rendering tests. The component only reads
 * `id`, `a11y.role`, `a11y.name`, `a11y.properties.level`, `a11y.states`,
 * `dom.tagName`, `dom.textContent`, and `interaction.actions` — everything
 * else can stay as a safe default.
 */
function makeNode(overrides: {
  id: string;
  role: string;
  name?: string;
  tagName?: string;
  textContent?: string;
  level?: string;
  actions?: SemanticNode["interaction"]["actions"];
}): SemanticNode {
  return {
    id: overrides.id,
    a11y: {
      role: overrides.role,
      name: overrides.name ?? "",
      description: "",
      properties: overrides.level ? { level: overrides.level } : {},
      states: {},
    },
    dom: {
      tagName: overrides.tagName ?? "div",
      attributes: {},
      textContent: overrides.textContent ?? "",
    },
    interaction: {
      focusable: false,
      actions: overrides.actions ?? [],
    },
    children: [],
  } as unknown as SemanticNode;
}

describe("FilteredList (smoke)", () => {
  let container: HTMLDivElement;
  let originalScrollIntoView: typeof Element.prototype.scrollIntoView;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    // jsdom does not implement scrollIntoView; stub so the selection effect
    // inside FilteredList doesn't throw from a deferred timer.
    originalScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function () {};
  });

  afterEach(() => {
    render(null, container);
    container.remove();
    Element.prototype.scrollIntoView = originalScrollIntoView;
  });

  const noop = () => {};

  it("renders an empty state when no nodes match the filter", () => {
    render(
      <FilteredList
        nodes={new Map()}
        roleFilter="button"
        query=""
        onSelect={noop}
        onActivate={noop}
      />,
      container,
    );

    const listbox = container.querySelector('[role="listbox"]');
    expect(listbox).not.toBeNull();
    expect(listbox?.getAttribute("aria-label")).toBe("button elements");

    const empty = container.querySelector(".sn-empty");
    expect(empty).not.toBeNull();
    expect(empty?.textContent).toContain("No buttons found");
  });

  it("renders heading matches with level badges and includes query in empty text", () => {
    const nodes = new Map<string, SemanticNode>();
    nodes.set(
      "n1",
      makeNode({
        id: "n1",
        role: "heading",
        name: "Alpha",
        tagName: "h1",
        level: "1",
      }),
    );
    nodes.set(
      "n2",
      makeNode({
        id: "n2",
        role: "heading",
        name: "Beta",
        tagName: "h2",
        level: "2",
      }),
    );
    nodes.set(
      "n3",
      makeNode({
        id: "n3",
        role: "button",
        name: "Irrelevant",
        tagName: "button",
      }),
    );

    render(
      <FilteredList
        nodes={nodes}
        roleFilter="heading"
        query=""
        onSelect={noop}
        onActivate={noop}
      />,
      container,
    );

    const options = container.querySelectorAll<HTMLElement>('[role="option"]');
    expect(options.length).toBe(2);

    // First option should reflect selectedIndex=0 → aria-selected="true".
    expect(options[0].getAttribute("aria-selected")).toBe("true");
    expect(options[1].getAttribute("aria-selected")).toBe("false");

    // Level badges are rendered for headings.
    const badges = container.querySelectorAll(".sn-level-badge");
    expect(badges.length).toBe(2);
    expect(badges[0].textContent).toBe("H1");
    expect(badges[1].textContent).toBe("H2");

    // Query-aware empty state.
    render(
      <FilteredList
        nodes={nodes}
        roleFilter="heading"
        query="zzz"
        onSelect={noop}
        onActivate={noop}
      />,
      container,
    );
    const empty = container.querySelector(".sn-empty");
    expect(empty?.textContent).toContain('matching "zzz"');
  });

  it("points aria-activedescendant at the active option, and drops it when the list shrinks past the selection", () => {
    const buttons = (n: number) => {
      const m = new Map<string, SemanticNode>();
      for (let i = 1; i <= n; i++) {
        m.set(
          `n${i}`,
          makeNode({
            id: `n${i}`,
            role: "button",
            name: `B${i}`,
            tagName: "button",
          }),
        );
      }
      return m;
    };

    const list = (n: number) => (
      <FilteredList
        nodes={buttons(n)}
        roleFilter="button"
        query=""
        onSelect={noop}
        onActivate={noop}
      />
    );

    act(() => render(list(3), container));

    const listbox = container.querySelector<HTMLElement>('[role="listbox"]')!;
    const options = () =>
      Array.from(container.querySelectorAll<HTMLElement>('[role="option"]'));
    // Container-focus composite: the active option is announced by id, and that
    // id must resolve to a rendered row (prefixed per mount so concurrent
    // panels don't collide).
    expect(listbox.getAttribute("aria-activedescendant")).toBe(
      options()[0]!.id,
    );
    expect(options()[0]!.id).toMatch(/^sn-ui-filtered-opt-/);
    expect(
      container.querySelectorAll(`[id="${options()[0]!.id}"]`),
    ).toHaveLength(1);

    // Arrow off the first row — the keyboard path this feature exists for.
    act(() => {
      listbox.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });
    expect(listbox.getAttribute("aria-activedescendant")).toBe(
      options()[1]!.id,
    );

    // The page mutates: the filter still matches, but only one element remains.
    // selectedIndex (1) is NOT reset (filter/query unchanged), so a guard that
    // only tested non-emptiness would keep pointing at the now-missing opt-1 —
    // leaving a screen reader with nothing to announce.
    act(() => render(list(1), container));
    expect(container.querySelectorAll('[role="option"]')).toHaveLength(1);
    expect(listbox.getAttribute("aria-activedescendant")).toBeNull();
  });
});
