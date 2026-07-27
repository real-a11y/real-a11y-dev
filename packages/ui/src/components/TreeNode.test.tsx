import type { ActionType, DomSemanticNode } from "@real-a11y-dev/core";
import { render } from "preact";
import { act } from "preact/test-utils";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { TreeNode } from "./TreeNode.js";
import type { ControlsLink } from "./TreePanel.js";

function makeNode(
  overrides: Partial<DomSemanticNode> & { id: string },
): DomSemanticNode {
  return {
    id: overrides.id,
    parentId: overrides.parentId ?? null,
    childIds: overrides.childIds ?? [],
    depth: overrides.depth ?? 0,
    a11y: overrides.a11y ?? {
      role: "button",
      name: "Save",
      description: "",
      states: {},
      properties: {},
      isExposedToAT: true,
    },
    dom: overrides.dom ?? {
      tagName: "BUTTON",
      attributes: {},
      textContent: "Save",
      descendantText: "Save",
      isHidden: false,
    },
    interaction: overrides.interaction ?? {
      isInteractive: true,
      isFocusable: true,
      isEditable: false,
      actions: ["click"],
    },
    ui: overrides.ui ?? {
      expanded: false,
      highlighted: false,
      matchesFilter: true,
      selected: false,
    },
  };
}

describe("TreeNode", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    container.remove();
  });

  function mount(
    node: DomSemanticNode,
    props: {
      viewMode?: "dom" | "a11y" | "tab";
      isSelected?: boolean;
      isFlashing?: boolean;
      onSelect?: (id: string) => void;
      onToggle?: (id: string) => void;
      onActivate?: (id: string, action?: ActionType) => void;
      onHover?: (id: string | null) => void;
      onJumpToNode?: (id: string) => void;
      controlsLinks?: ControlsLink[];
    } = {},
  ) {
    const onSelect = props.onSelect ?? vi.fn();
    const onToggle = props.onToggle ?? vi.fn();
    const onActivate = props.onActivate ?? vi.fn();
    const onHover = props.onHover ?? vi.fn();
    act(() => {
      render(
        <TreeNode
          node={node}
          viewMode={props.viewMode ?? "a11y"}
          isSelected={props.isSelected ?? false}
          isFlashing={props.isFlashing}
          onSelect={onSelect}
          onToggle={onToggle}
          onActivate={onActivate}
          onHover={onHover}
          controlsLinks={props.controlsLinks}
          onJumpToNode={props.onJumpToNode}
        />,
        container,
      );
    });
    return {
      row: container.querySelector<HTMLElement>('[role="treeitem"]')!,
      onSelect,
      onToggle,
      onActivate,
      onHover,
    };
  }

  it("renders a11y labels, badges, and selected/flashing classes", () => {
    const node = makeNode({
      id: "h1",
      a11y: {
        role: "heading",
        name: "Title",
        description: "",
        states: { expanded: true },
        properties: { level: "1" },
        isExposedToAT: true,
      },
      interaction: {
        isInteractive: true,
        isFocusable: true,
        isEditable: false,
        actions: [],
      },
    });
    const { row } = mount(node, { isSelected: true, isFlashing: true });

    expect(row.className).toContain("sn-node--selected");
    expect(row.className).toContain("sn-node--flash");
    expect(row.className).toContain("sn-node--interactive");
    expect(row.getAttribute("aria-selected")).toBe("true");
    expect(row.getAttribute("aria-level")).toBe("1");
    expect(row.querySelector(".sn-role")?.textContent).toBe("heading");
    expect(row.querySelector(".sn-text-muted")?.textContent).toContain(
      "level 1",
    );
    expect(row.querySelector(".sn-name")?.textContent).toBe("Title");
    expect(row.textContent).toContain("interactive");
    expect(row.textContent).toContain("focusable");
    expect(row.textContent).toContain("expanded");
  });

  it("renders a DOM-mode label with selected attributes", () => {
    const node = makeNode({
      id: "link",
      a11y: {
        role: "link",
        name: "Docs",
        description: "",
        states: {},
        properties: {},
        isExposedToAT: true,
      },
      dom: {
        tagName: "A",
        attributes: {
          id: "docs",
          class: "primary secondary tertiary extra",
          href: "/docs",
        },
        textContent: "Docs",
        descendantText: "Docs",
        isHidden: false,
      },
      interaction: {
        isInteractive: true,
        isFocusable: true,
        isEditable: false,
        actions: ["navigate"],
      },
    });
    const { row } = mount(node, { viewMode: "dom" });

    expect(row.querySelector(".sn-tag")?.textContent).toBe("<A");
    expect(row.textContent).toContain('id="docs"');
    expect(row.textContent).toContain('class="primary secondary tertiary"');
    expect(row.textContent).toContain('href="/docs"');
    expect(row.textContent).not.toContain("extra");
  });

  it("selects on click, toggles parents on double-click, and ignores leaf toggles", () => {
    const parent = makeNode({
      id: "parent",
      childIds: ["child"],
      a11y: {
        role: "group",
        name: "Parent",
        description: "",
        states: {},
        properties: {},
        isExposedToAT: true,
      },
      interaction: {
        isInteractive: false,
        isFocusable: false,
        isEditable: false,
        actions: [],
      },
    });
    const { row, onSelect, onToggle } = mount(parent);

    act(() => {
      row.click();
    });
    expect(onSelect).toHaveBeenCalledWith("parent");

    act(() => {
      row.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(onToggle).toHaveBeenCalledWith("parent");

    const leaf = makeNode({ id: "leaf" });
    const leafMount = mount(leaf);
    act(() => {
      leafMount.row.querySelector<HTMLButtonElement>(".sn-toggle")!.click();
    });
    expect(leafMount.onToggle).not.toHaveBeenCalled();
  });

  it("dispatches the primary action, or a step pair for sliders", () => {
    const button = makeNode({ id: "btn" });
    const { row, onActivate } = mount(button);
    act(() => {
      row.querySelector<HTMLButtonElement>(".sn-action")!.click();
    });
    expect(onActivate).toHaveBeenCalledWith("btn");
    expect(row.querySelector(".sn-action-pair")).toBeNull();

    const slider = makeNode({
      id: "vol",
      a11y: {
        role: "slider",
        name: "Volume",
        description: "",
        states: {},
        properties: {},
        isExposedToAT: true,
      },
      interaction: {
        isInteractive: true,
        isFocusable: true,
        isEditable: false,
        actions: ["increment", "decrement", "focus"],
      },
    });
    const step = mount(slider);
    expect(
      step.row.querySelector(".sn-action:not(.sn-action--step)"),
    ).toBeNull();
    act(() => {
      step.row
        .querySelector<HTMLButtonElement>('[aria-label="Decrement"]')!
        .click();
    });
    expect(step.onActivate).toHaveBeenCalledWith("vol", "decrement");
    act(() => {
      step.row
        .querySelector<HTMLButtonElement>('[aria-label="Increment"]')!
        .click();
    });
    expect(step.onActivate).toHaveBeenCalledWith("vol", "increment");
  });

  it("fires cross-link chips without selecting the row", () => {
    const onJumpToNode = vi.fn();
    const node = makeNode({ id: "trigger" });
    const { row, onSelect } = mount(node, {
      controlsLinks: [{ id: "menu", label: 'menu "Options"', inferred: false }],
      onJumpToNode,
    });

    act(() => {
      row.querySelector<HTMLButtonElement>(".sn-controls-link")!.click();
    });
    expect(onJumpToNode).toHaveBeenCalledWith("menu");
    expect(onSelect).not.toHaveBeenCalled();
  });
});
