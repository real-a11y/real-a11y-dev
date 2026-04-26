import type { SemanticNode } from "@real-a11y-dev/core";
import { render } from "preact";
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
});
