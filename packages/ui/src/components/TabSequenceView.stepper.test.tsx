import type {
  ActionType,
  DomSemanticNode,
  SemanticNode,
} from "@real-a11y-dev/core";
import { render } from "preact";
import { act } from "preact/test-utils";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { TabSequenceView } from "./TabSequenceView.js";

function makeFocusableSlider(id: string, name: string): DomSemanticNode {
  return {
    id,
    parentId: "root",
    childIds: [],
    depth: 1,
    a11y: {
      role: "slider",
      name,
      description: "",
      states: {},
      properties: {},
      isExposedToAT: true,
    },
    dom: {
      tagName: "INPUT",
      attributes: { type: "range" },
      textContent: "",
      descendantText: "",
      isHidden: false,
    },
    interaction: {
      isInteractive: true,
      isFocusable: true,
      isEditable: false,
      actions: ["increment", "decrement", "focus"],
    },
    ui: {
      expanded: false,
      highlighted: false,
      matchesFilter: true,
      selected: false,
    },
  };
}

function makeRoot(childId: string): DomSemanticNode {
  return {
    id: "root",
    parentId: null,
    childIds: [childId],
    depth: 0,
    a11y: {
      role: "generic",
      name: "",
      description: "",
      states: {},
      properties: {},
      isExposedToAT: true,
    },
    dom: {
      tagName: "DIV",
      attributes: {},
      textContent: "",
      descendantText: "",
      isHidden: false,
    },
    interaction: {
      isInteractive: false,
      isFocusable: false,
      isEditable: false,
      actions: [],
    },
    ui: {
      expanded: true,
      highlighted: false,
      matchesFilter: true,
      selected: false,
    },
  };
}

describe("TabSequenceView stepper keys", () => {
  let container: HTMLDivElement;
  let originalScrollIntoView: typeof Element.prototype.scrollIntoView;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    originalScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function () {};
  });

  afterEach(() => {
    render(null, container);
    container.remove();
    Element.prototype.scrollIntoView = originalScrollIntoView;
  });

  function mount(onActivate: (id: string, action?: ActionType) => void) {
    const nodes = new Map<string, SemanticNode>([
      ["root", makeRoot("vol")],
      ["vol", makeFocusableSlider("vol", "Volume")],
    ]);
    act(() => {
      render(
        <TabSequenceView
          nodes={nodes}
          rootId="root"
          query=""
          onSelect={() => {}}
          onActivate={onActivate}
          onHover={() => {}}
        />,
        container,
      );
    });
    return container.querySelector<HTMLElement>('[role="listbox"]')!;
  }

  function press(
    list: HTMLElement,
    key: string,
    mods: { shift?: boolean } = {},
  ) {
    act(() => {
      list.dispatchEvent(
        new KeyboardEvent("keydown", {
          key,
          bubbles: true,
          shiftKey: !!mods.shift,
        }),
      );
    });
  }

  it("dispatches decrement on - and Shift+Enter, increment on + and plain Enter", () => {
    const onActivate = vi.fn();
    const list = mount(onActivate);

    press(list, "-");
    expect(onActivate).toHaveBeenLastCalledWith("vol", "decrement");

    press(list, "Enter", { shift: true });
    expect(onActivate).toHaveBeenLastCalledWith("vol", "decrement");

    press(list, "+");
    expect(onActivate).toHaveBeenLastCalledWith("vol", "increment");

    press(list, "Enter");
    // Plain Enter leaves action undefined so getPrimaryAction (increment) runs
    // in the panel's handleActivate — not hard-coded here.
    expect(onActivate).toHaveBeenLastCalledWith("vol", undefined);
  });
});
