import {
  extractA11yTree,
  extractDomTree,
  type ExtractionResult,
} from "@real-a11y-dev/core";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EVENTS, type TreeUpdatePayload } from "./constants.js";
import {
  StoryTree,
  type StoryRead,
  type StoryTreeProps,
} from "./story-tree.js";

/** The channel's half the tree listens on, which a test speaks for. */
function fakeChannel() {
  const listeners = new Map<string, Set<(input: unknown) => void>>();
  return {
    on(event: string, cb: (input: unknown) => void) {
      listeners.set(event, (listeners.get(event) ?? new Set()).add(cb));
    },
    off(event: string, cb: (input: unknown) => void) {
      listeners.get(event)?.delete(cb);
    },
    emit(event: string, input: unknown) {
      for (const cb of listeners.get(event) ?? []) cb(input);
    },
  };
}

/**
 * The change marks in the Storybook panel: `StoryTree` compares each update
 * the story sends with the one before (`usePageChanges`) and hands
 * `TreePanel` what it found.
 */
describe("StoryTree change marks", () => {
  let container: HTMLDivElement;
  let story: HTMLElement;
  let channel: ReturnType<typeof fakeChannel>;
  let originalScrollIntoView: typeof Element.prototype.scrollIntoView;

  beforeEach(() => {
    container = document.body.appendChild(document.createElement("div"));
    story = document.body.appendChild(document.createElement("div"));
    story.innerHTML = `<button id="open">Open menu</button><button>Save</button>`;
    channel = fakeChannel();
    originalScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function () {};
  });

  afterEach(() => {
    render(null, container);
    container.remove();
    story.remove();
    Element.prototype.scrollIntoView = originalScrollIntoView;
  });

  /** An update of the story as the channel brings it: a copy, in JSON. */
  function read(
    mode: "a11y" | "dom" = "a11y",
    {
      fresh = false,
      storyRows,
    }: Partial<Pick<StoryRead, "fresh">> & {
      storyRows?: (tree: ExtractionResult) => TreeUpdatePayload["storyRows"];
    } = {},
  ): StoryRead {
    const extracted = (mode === "dom" ? extractDomTree : extractA11yTree)(
      story,
    );
    const payload: TreeUpdatePayload = JSON.parse(
      JSON.stringify({
        tree: { nodes: [...extracted.nodes], rootId: extracted.rootId },
        mode,
        extractedAt: 0,
        storyRows: storyRows?.(extracted) ?? {
          rootId: extracted.rootId,
          outside: [],
        },
      }),
    );
    const tree = {
      nodes: new Map(payload.tree.nodes),
      rootId: payload.tree.rootId,
      source: { producer: "dom" as const },
    };
    return { payload, tree, fresh };
  }

  const onActivate = vi.fn();
  function show(next: StoryRead, props: Partial<StoryTreeProps> = {}) {
    act(() => {
      render(
        h(StoryTree, {
          read: next,
          markChanges: true,
          channel,
          viewMode: next.payload.mode,
          onViewModeChange: () => {},
          onActivate,
          ...props,
        }),
        container,
      );
    });
  }

  const rowNamed = (name: string) =>
    [...container.querySelectorAll<HTMLElement>('[role="treeitem"]')].find(
      (r) => r.querySelector(".sn-name")?.textContent === name,
    );
  const isNew = (name: string) =>
    rowNamed(name)?.classList.contains("sn-node--change-new") ?? false;
  const said = () =>
    container.querySelector('[aria-live="polite"]')?.textContent ?? null;
  const bar = () => container.querySelector(".sn-changes-bar");
  const addButton = (name: string) => {
    const button = document.createElement("button");
    button.textContent = name;
    story.appendChild(button);
  };

  it("marks what the story changed, without saying it", () => {
    show(read("a11y", { fresh: true }));
    addButton("Delete");
    show(read());
    expect(isNew("Delete")).toBe(true);
    expect(isNew("Save")).toBe(false);
    // Nobody caused it: marked, not said.
    expect(said()).toBe("");
  });

  it("says what follows what the user does on the story", () => {
    show(read("a11y", { fresh: true }));
    act(() => channel.emit(EVENTS.USER_INPUT, "act"));
    addButton("Menu item");
    show(read());
    expect(said()).toBe("1 new in the tree");
  });

  it("says what follows an action sent through the tree", () => {
    show(read("a11y", { fresh: true }));
    act(() => rowNamed("Save")!.click());
    const tree = container.querySelector<HTMLElement>('[role="tree"]')!;
    act(() => {
      tree.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(onActivate).toHaveBeenCalled();
    addButton("Undo");
    show(read());
    expect(said()).toBe("1 new in the tree");
  });

  it("hears nothing on the channel but what the user did", () => {
    show(read("a11y", { fresh: true }));
    act(() => channel.emit(EVENTS.USER_INPUT, "scroll"));
    addButton("Delete");
    show(read());
    expect(isNew("Delete")).toBe(true);
    expect(said()).toBe("");
  });

  it("starts over at an update that is fresh", () => {
    show(read("a11y", { fresh: true }));
    addButton("Delete");
    show(read());
    expect(bar()).not.toBeNull();

    addButton("Undo");
    show(read("a11y", { fresh: true }));
    expect(bar()).toBeNull();
    expect(isNew("Undo")).toBe(false);
  });

  // A story on its way in, read before it first rendered: what its render
  // brings is the story, not a change to it.
  it("compares nothing with a tree read before the story rendered", () => {
    story.innerHTML = "";
    const early = read("a11y", { fresh: true });
    early.payload.storyRendered = false;
    show(early);
    story.innerHTML = `<button>Save</button>`;
    const rendered = read();
    rendered.payload.storyRendered = true;
    show(rendered);
    expect(isNew("Save")).toBe(false);
    expect(bar()).toBeNull();

    addButton("Delete");
    show(read());
    expect(isNew("Delete")).toBe(true);
  });

  it("starts over at an update of the other extraction", () => {
    show(read("a11y", { fresh: true }));
    addButton("Delete");
    show(read());
    expect(bar()).not.toBeNull();

    addButton("Undo");
    show(read("dom"));
    expect(bar()).toBeNull();
  });

  it("leaves alone the rows around the story that a widened read brings", () => {
    show(read("a11y", { fresh: true }));
    // The menu the story opened, and the page it brought: everything but the
    // story's own rows is the page's.
    addButton("Delete");
    show(
      read("a11y", {
        storyRows: (tree) => ({
          rootId: tree.rootId,
          outside: [...tree.nodes.values()]
            .filter((n) => n.a11y.name === "Delete")
            .map((n) => n.id),
        }),
      }),
    );
    expect(isNew("Delete")).toBe(false);
    expect(bar()).toBeNull();
  });

  it("marks nothing with markChanges off", () => {
    show(read("a11y", { fresh: true }), { markChanges: false });
    addButton("Delete");
    show(read(), { markChanges: false });
    expect(rowNamed("Delete")).toBeDefined();
    expect(isNew("Delete")).toBe(false);
    expect(bar()).toBeNull();
    expect(said()).toBeNull();
  });
});
