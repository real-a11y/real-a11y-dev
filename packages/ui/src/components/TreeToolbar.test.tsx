import { render } from "preact";
import { act } from "preact/test-utils";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

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
    expect(filterButtons?.length ?? 0).toBeGreaterThan(0);
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

describe("TreeToolbar Settings", () => {
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

  function toolbar(
    into: Element,
    props: {
      showFullNames?: boolean;
      onShowFullNamesChange?: (on: boolean) => void;
    } = {},
  ) {
    act(() => {
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
          {...props}
        />,
        into,
      );
    });
  }

  const gear = (root: ParentNode) =>
    root.querySelector<HTMLButtonElement>('button[aria-label="Settings"]')!;
  const popup = (root: ParentNode) =>
    root.querySelector<HTMLElement>('[role="group"][aria-label="Settings"]');
  const checkbox = (root: ParentNode) =>
    popup(root)!.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  /** A press, as the browser starts one: composed, so it leaves a shadow root. */
  const press = (target: EventTarget) =>
    act(() => {
      target.dispatchEvent(
        new Event("pointerdown", { bubbles: true, composed: true }),
      );
    });

  it("opens as a disclosure holding the Show full names switch", () => {
    toolbar(container);

    const button = gear(container);
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(button.hasAttribute("aria-controls")).toBe(false);
    expect(popup(container)).toBeNull();

    act(() => button.click());

    expect(button.getAttribute("aria-expanded")).toBe("true");
    const group = popup(container)!;
    expect(button.getAttribute("aria-controls")).toBe(group.id);
    const box = checkbox(container);
    expect(box.closest("label")?.textContent).toBe("Show full names");
    const hint = container.querySelector(
      `#${box.getAttribute("aria-describedby")}`,
    );
    expect(hint?.textContent).toMatch(/scrolls sideways/);

    act(() => button.click());
    expect(popup(container)).toBeNull();
  });

  it("mirrors showFullNames and reports a change", () => {
    const onChange = vi.fn();
    toolbar(container, {
      showFullNames: true,
      onShowFullNamesChange: onChange,
    });
    act(() => gear(container).click());

    expect(checkbox(container).checked).toBe(true);
    act(() => checkbox(container).click());
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("closes on Escape from inside it, returning focus to the gear", () => {
    toolbar(container);
    act(() => gear(container).click());
    checkbox(container).focus();

    act(() => {
      checkbox(container).dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });

    expect(popup(container)).toBeNull();
    expect(document.activeElement).toBe(gear(container));
  });

  it("stays open for a press inside it and closes for one outside", () => {
    toolbar(container);
    act(() => gear(container).click());

    press(container.querySelector(".sn-settings-hint")!);
    expect(popup(container)).not.toBeNull();

    press(document.body);
    expect(popup(container)).toBeNull();
  });

  it("closes when focus moves out of it, not when focus goes nowhere", () => {
    toolbar(container);
    act(() => gear(container).click());
    const box = checkbox(container);
    act(() => box.focus());

    // A press on the popup's own text sends focus to the body: it stays.
    act(() => {
      box.dispatchEvent(
        new FocusEvent("focusout", { bubbles: true, relatedTarget: null }),
      );
    });
    expect(popup(container)).not.toBeNull();

    // Tab on to the role filters, which the popup lies over: it closes.
    act(() =>
      container.querySelector<HTMLButtonElement>(".sn-filter-btn")!.focus(),
    );
    expect(popup(container)).toBeNull();
  });

  // The inspector mounts the panel in a shadow root, where a listener on the
  // document sees a press inside it retargeted to the host: read naively, a
  // press on the popup's own checkbox would be "outside" and close it.
  it("tells inside from outside within a shadow root", () => {
    const shadow = container.attachShadow({ mode: "open" });
    const mount = document.createElement("div");
    shadow.appendChild(mount);
    toolbar(mount);
    act(() => gear(shadow).click());

    press(checkbox(shadow));
    expect(popup(shadow)).not.toBeNull();

    press(document.body);
    expect(popup(shadow)).toBeNull();
    render(null, mount);
  });

  // A closed shadow root hides its nodes from the document altogether, and
  // a page can put the inspector's own (open) root inside one.
  it("tells inside from outside within shadow roots nested in a closed one", () => {
    const outer = container.attachShadow({ mode: "closed" });
    const host = document.createElement("div");
    const sibling = document.createElement("button");
    outer.append(host, sibling);
    const shadow = host.attachShadow({ mode: "open" });
    const mount = document.createElement("div");
    shadow.appendChild(mount);
    toolbar(mount);
    act(() => gear(shadow).click());

    press(checkbox(shadow));
    expect(popup(shadow)).not.toBeNull();

    // Inside the closed root, but outside the panel's.
    press(sibling);
    expect(popup(shadow)).toBeNull();

    act(() => gear(shadow).click());
    press(document.body);
    expect(popup(shadow)).toBeNull();
    render(null, mount);
  });
});
