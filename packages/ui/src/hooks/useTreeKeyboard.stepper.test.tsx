import type {
  A11yInfo,
  ActionType,
  InteractionInfo,
  SemanticNode,
} from "@real-a11y-dev/core";
import { render } from "preact";
import { useState } from "preact/hooks";
import { act } from "preact/test-utils";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { useTreeKeyboard } from "./useTreeKeyboard.js";

function a11y(name: string, role = "slider"): A11yInfo {
  return {
    role,
    name,
    description: "",
    states: {},
    properties: {},
    isExposedToAT: true,
  };
}

function makeStepper(id: string, name: string): SemanticNode {
  const interaction: InteractionInfo = {
    isInteractive: true,
    isFocusable: true,
    isEditable: false,
    actions: ["increment", "decrement", "focus"],
  };
  return {
    id,
    parentId: "root",
    childIds: [],
    depth: 1,
    a11y: a11y(name),
    interaction,
    ui: {
      expanded: false,
      highlighted: false,
      matchesFilter: true,
      selected: false,
    },
  };
}

function Harness({
  onActivate,
}: {
  onActivate: (id: string, action?: ActionType) => void;
}) {
  const nodes = new Map<string, SemanticNode>([
    ["vol", makeStepper("vol", "Volume")],
  ]);
  const visibleNodeIds = ["vol"];
  const [selectedId] = useState<string | null>("vol");
  const { handleKeyDown } = useTreeKeyboard({
    nodes,
    visibleNodeIds,
    selectedId,
    onSelect: () => {},
    onToggle: () => {},
    onActivate,
  });
  return (
    <div
      role="tree"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      data-testid="tree"
    />
  );
}

describe("useTreeKeyboard stepper keys", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    container.remove();
  });

  function mount(onActivate: (id: string, action?: ActionType) => void) {
    act(() => {
      render(<Harness onActivate={onActivate} />, container);
    });
    return container.querySelector<HTMLElement>('[role="tree"]')!;
  }

  function press(
    tree: HTMLElement,
    key: string,
    mods: { shift?: boolean } = {},
  ) {
    act(() => {
      tree.dispatchEvent(
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
    const tree = mount(onActivate);

    press(tree, "-");
    expect(onActivate).toHaveBeenLastCalledWith("vol", "decrement");

    press(tree, "Enter", { shift: true });
    expect(onActivate).toHaveBeenLastCalledWith("vol", "decrement");

    press(tree, "+");
    expect(onActivate).toHaveBeenLastCalledWith("vol", "increment");

    press(tree, "Enter");
    // Plain Enter leaves action undefined so getPrimaryAction (increment) runs
    // in the panel's handleActivate — not hard-coded here.
    expect(onActivate).toHaveBeenLastCalledWith("vol", undefined);
  });
});
