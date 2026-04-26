import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render } from "preact";
import { TreeToolbar } from "./TreeToolbar.js";

describe("TreeToolbar (smoke)", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    container.remove();
  });

  const noop = () => {};

  it("renders search, view-mode toggle, and role filters without throwing", () => {
    render(
      <TreeToolbar
        viewMode="a11y"
        onViewModeChange={noop}
        query=""
        onQueryChange={noop}
        matchCount={0}
        onExpandAll={noop}
        onCollapseAll={noop}
        roleFilter={null}
        onRoleFilterChange={noop}
      />,
      container,
    );

    // Search input
    const search = container.querySelector<HTMLInputElement>(
      'input[type="search"]',
    );
    expect(search).not.toBeNull();
    expect(search?.getAttribute("aria-label")).toBe("Search tree nodes");

    // View-mode toggle — DOM / A11Y / TAB
    const toggleGroup = container.querySelector(
      '[role="group"][aria-label="Tree view mode"]',
    );
    expect(toggleGroup).not.toBeNull();
    const toggleButtons = toggleGroup?.querySelectorAll("button");
    expect(toggleButtons?.length).toBe(3);

    // The current mode is marked aria-pressed on exactly one toggle button.
    const pressedCount = Array.from(toggleButtons ?? []).filter(
      (b) => b.getAttribute("aria-pressed") === "true",
    ).length;
    expect(pressedCount).toBe(1);

    // Role-filter toolbar exists and has at least one filter button.
    const filterToolbar = container.querySelector(
      '[role="toolbar"][aria-label="Filter by role"]',
    );
    expect(filterToolbar).not.toBeNull();
    const filterButtons = filterToolbar?.querySelectorAll("button");
    expect((filterButtons?.length ?? 0)).toBeGreaterThan(0);
  });

  it("shows a match count only when a query or filter is active", () => {
    // No query, no filter → no count element.
    render(
      <TreeToolbar
        viewMode="a11y"
        onViewModeChange={noop}
        query=""
        onQueryChange={noop}
        matchCount={5}
        onExpandAll={noop}
        onCollapseAll={noop}
        roleFilter={null}
        onRoleFilterChange={noop}
      />,
      container,
    );
    expect(container.querySelector(".sn-search-count")).toBeNull();

    // With a query, the live-polite count appears.
    render(
      <TreeToolbar
        viewMode="a11y"
        onViewModeChange={noop}
        query="button"
        onQueryChange={noop}
        matchCount={3}
        onExpandAll={noop}
        onCollapseAll={noop}
        roleFilter={null}
        onRoleFilterChange={noop}
      />,
      container,
    );
    const count = container.querySelector(".sn-search-count");
    expect(count).not.toBeNull();
    expect(count?.getAttribute("aria-live")).toBe("polite");
    expect(count?.textContent).toContain("3 matches");
  });

  it("disables expand/collapse and role filters in tab view", () => {
    render(
      <TreeToolbar
        viewMode="tab"
        onViewModeChange={noop}
        query=""
        onQueryChange={noop}
        matchCount={0}
        onExpandAll={noop}
        onCollapseAll={noop}
        roleFilter={null}
        onRoleFilterChange={noop}
      />,
      container,
    );

    const expand = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Expand all nodes"]',
    );
    const collapse = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Collapse all nodes"]',
    );
    expect(expand?.disabled).toBe(true);
    expect(collapse?.disabled).toBe(true);

    const filterButtons = container.querySelectorAll<HTMLButtonElement>(
      '[role="toolbar"][aria-label="Filter by role"] button',
    );
    expect(filterButtons.length).toBeGreaterThan(0);
    for (const btn of Array.from(filterButtons)) {
      expect(btn.disabled).toBe(true);
    }
  });
});
