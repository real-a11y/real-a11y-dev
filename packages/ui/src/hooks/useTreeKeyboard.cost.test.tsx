import type {
  A11yInfo,
  InteractionInfo,
  SemanticNode,
} from "@real-a11y-dev/core";
import { render } from "preact";
import { useState } from "preact/hooks";
import { act } from "preact/test-utils";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { useTreeKeyboard } from "./useTreeKeyboard.js";

function a11y(name: string, role = "group"): A11yInfo {
  return {
    role,
    name,
    description: "",
    states: {},
    properties: {},
    isExposedToAT: true,
  };
}

function makeNode(
  id: string,
  opts: {
    name?: string;
    parentId?: string | null;
    childIds?: string[];
    expanded?: boolean;
    depth?: number;
  } = {},
): SemanticNode {
  const interaction: InteractionInfo = {
    isInteractive: false,
    isFocusable: false,
    isEditable: false,
    actions: [],
  };
  return {
    id,
    parentId: opts.parentId === undefined ? "root" : opts.parentId,
    childIds: opts.childIds ?? [],
    depth: opts.depth ?? 1,
    a11y: a11y(opts.name ?? id),
    interaction,
    ui: {
      expanded: opts.expanded ?? false,
      highlighted: false,
      matchesFilter: true,
      selected: false,
    },
  };
}

/**
 * A `visibleNodeIds` array that records every linear scan run over it.
 *
 * `indexOf`/`includes` are own properties, so they shadow `Array.prototype`
 * for this instance only — the hook still sees an ordinary `string[]`.
 */
function countingIds(ids: string[]) {
  const scans = { indexOf: 0, includes: 0 };
  const arr = ids.slice();
  Object.defineProperty(arr, "indexOf", {
    value(this: string[], ...args: [string]) {
      scans.indexOf += 1;
      return Array.prototype.indexOf.apply(this, args);
    },
  });
  Object.defineProperty(arr, "includes", {
    value(this: string[], ...args: [string]) {
      scans.includes += 1;
      return Array.prototype.includes.apply(this, args);
    },
  });
  return { arr, scans };
}

function Harness({
  nodes,
  visibleNodeIds,
  initialSelectedId,
}: {
  nodes: Map<string, SemanticNode>;
  visibleNodeIds: string[];
  initialSelectedId: string | null;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(
    initialSelectedId,
  );
  const { handleKeyDown } = useTreeKeyboard({
    nodes,
    visibleNodeIds,
    selectedId,
    onSelect: setSelectedId,
    onToggle: vi.fn(),
    onActivate: vi.fn(),
  });
  return (
    <div
      role="tree"
      tabIndex={0}
      data-selected={selectedId ?? ""}
      onKeyDown={handleKeyDown}
    />
  );
}

/**
 * Guards the cost of keyboard navigation.
 *
 * Arrow navigation only ever needs the *index* of the selected row, and
 * ArrowRight only needs to know whether a child id is visible. Both are
 * answerable from an id→index map built once per `visibleNodeIds` identity,
 * so neither should walk the list on each keypress. Before the index map,
 * every keypress ran `visibleNodeIds.indexOf(selectedId)` (O(N)) and
 * ArrowRight additionally ran `visibleNodeIds.includes(childId)` per child
 * (O(children x N)).
 */
describe("useTreeKeyboard navigation cost", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    container.remove();
  });

  function press(tree: HTMLElement, key: string) {
    act(() => {
      tree.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
      );
    });
  }

  function mount(nodes: Map<string, SemanticNode>, visibleNodeIds: string[]) {
    act(() => {
      render(
        <Harness
          nodes={nodes}
          visibleNodeIds={visibleNodeIds}
          initialSelectedId={visibleNodeIds[0] ?? null}
        />,
        container,
      );
    });
    return container.querySelector<HTMLElement>('[role="tree"]')!;
  }

  it("does not rescan the visible list on each arrow keypress", () => {
    const ids = Array.from({ length: 40 }, (_, i) => `n${i}`);
    const nodes = new Map(ids.map((id) => [id, makeNode(id)]));
    const { arr, scans } = countingIds(ids);

    const tree = mount(nodes, arr);
    for (let i = 0; i < 6; i++) press(tree, "ArrowDown");

    // Navigation still lands where it should.
    expect(tree.dataset.selected).toBe("n6");
    expect(scans.indexOf).toBe(0);
  });

  it("does not scan the visible list per child when expanding right", () => {
    const childIds = Array.from({ length: 12 }, (_, i) => `c${i}`);
    const parent = makeNode("parent", {
      childIds,
      expanded: true,
      parentId: null,
    });
    const nodes = new Map<string, SemanticNode>([["parent", parent]]);
    for (const id of childIds) {
      nodes.set(id, makeNode(id, { parentId: "parent", depth: 2 }));
    }
    const { arr, scans } = countingIds(["parent", ...childIds]);

    const tree = mount(nodes, arr);
    press(tree, "ArrowRight");

    // Still moves to the first visible child.
    expect(tree.dataset.selected).toBe("c0");
    expect(scans.indexOf).toBe(0);
    expect(scans.includes).toBe(0);
  });
});
