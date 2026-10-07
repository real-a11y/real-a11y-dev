import type { SemanticNode } from "@real-a11y-dev/core";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { JumpLinks } from "./jumpKeys.js";
import { useTreeKeyboard } from "./useTreeKeyboard.js";

function node(id: string): SemanticNode {
  return {
    id,
    parentId: "root",
    childIds: [],
    depth: 1,
    a11y: {
      role: "tab",
      name: id,
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
    ui: {
      expanded: false,
      highlighted: false,
      matchesFilter: true,
      selected: false,
    },
  };
}

const nodes = new Map(["tab", "panel", "other"].map((id) => [id, node(id)]));
const links: JumpLinks = {
  forward: new Map([["tab", ["panel", "other"]]]),
  reverse: new Map([
    ["panel", ["tab"]],
    ["other", ["tab"]],
  ]),
};

function Harness(props: {
  selectedId: string;
  jumpLinks?: JumpLinks;
  onJump?: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  const { jumpLinks, onJump } = props;
  const { handleKeyDown } = useTreeKeyboard({
    nodes,
    visibleNodeIds: [...nodes.keys()],
    selectedId: props.selectedId,
    onSelect: props.onSelect,
    onToggle: vi.fn(),
    onActivate: vi.fn(),
    jump: jumpLinks && onJump ? { links: jumpLinks, onJump } : undefined,
  });
  return <div role="tree" tabIndex={0} onKeyDown={handleKeyDown} />;
}

describe("useTreeKeyboard jump keys", () => {
  let container: HTMLDivElement;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });
  afterEach(() => {
    render(null, container);
    container.remove();
  });

  function press(
    props: Parameters<typeof Harness>[0],
    init: KeyboardEventInit,
  ): KeyboardEvent {
    act(() => render(<Harness {...props} />, container));
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      altKey: true,
      code: "KeyJ",
      key: "j",
      ...init,
    });
    act(() => {
      container.querySelector('[role="tree"]')!.dispatchEvent(event);
    });
    return event;
  }

  it("Alt+J jumps to the row the selection controls; Alt+Shift+J back", () => {
    const onJump = vi.fn();
    const onSelect = vi.fn();
    press({ selectedId: "tab", jumpLinks: links, onJump, onSelect }, {});
    expect(onJump).toHaveBeenLastCalledWith("panel");
    press(
      { selectedId: "panel", jumpLinks: links, onJump, onSelect },
      { shiftKey: true },
    );
    expect(onJump).toHaveBeenLastCalledWith("tab");
  });

  it("Alt+J again on the target moves on to the row's next link", () => {
    const onJump = vi.fn();
    const onSelect = vi.fn();
    press({ selectedId: "tab", jumpLinks: links, onJump, onSelect }, {});
    press({ selectedId: "panel", jumpLinks: links, onJump, onSelect }, {});
    expect(onJump).toHaveBeenLastCalledWith("other");
    // And back from there returns to where the run started.
    press(
      { selectedId: "other", jumpLinks: links, onJump, onSelect },
      { shiftKey: true },
    );
    expect(onJump).toHaveBeenLastCalledWith("tab");
  });

  it("consumes the key on a row with no link, without moving", () => {
    const onJump = vi.fn();
    const onSelect = vi.fn();
    const e = press(
      { selectedId: "other", jumpLinks: links, onJump, onSelect },
      {},
    );
    expect(onJump).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(true);
  });

  it("is no jump for a panel that passes no links: the key falls through", () => {
    const onSelect = vi.fn();
    // Untouched: Alt keeps it out of type-ahead too, so nothing claims it.
    const e = press({ selectedId: "tab", onSelect }, {});
    expect(onSelect).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
  });

  it("starts type-ahead afresh after a jump", () => {
    const onJump = vi.fn();
    const onSelect = vi.fn();
    const props = { selectedId: "tab", jumpLinks: links, onJump, onSelect };
    // "p" then, after the jump, "o": read as "po" it would match nothing.
    press(props, { altKey: false, code: "KeyP", key: "p" });
    press(props, {});
    onSelect.mockClear();
    press(props, { altKey: false, code: "KeyO", key: "o" });
    expect(onSelect).toHaveBeenLastCalledWith("other");
  });

  it("takes the key labelled J on another layout", () => {
    const onJump = vi.fn();
    const onSelect = vi.fn();
    press(
      { selectedId: "tab", jumpLinks: links, onJump, onSelect },
      { code: "KeyC", key: "j" },
    );
    expect(onJump).toHaveBeenLastCalledWith("panel");
  });
});
