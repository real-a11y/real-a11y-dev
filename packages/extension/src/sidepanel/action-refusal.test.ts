import type { SemanticNode } from "@real-a11y-dev/core";
import { render, h } from "preact";
import { act } from "preact/test-utils";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import type { ContentToPanel, PanelToContent } from "../types.js";

import { App } from "./App.js";
import type { ChromeMock } from "./panel-harness.js";
import { TAB_ID, installChromeMock, stubMatchMedia } from "./panel-harness.js";

/**
 * The panel's action feedback must describe what the page did, not what the
 * panel asked for. Every action path used to announce success on the strength
 * of the message having been sent, so a frame that answered and REFUSED —
 * which is how it reports that the action can't run, the element gone since
 * the page was read, say — still read as done. A TAB row's action is the one
 * a frame answers: Chrome's tree acts through the debugger.
 */

const ERROR = "Element no longer in DOM";

/** A one-button tree whose row is a tab stop and offers a click action. */
function actionableTree(): ContentToPanel {
  const mk = (
    id: string,
    parentId: string | null,
    depth: number,
    role: string,
    name: string,
    childIds: string[],
    actions: string[],
  ): [string, SemanticNode] => [
    id,
    {
      id,
      parentId,
      childIds,
      depth,
      a11y: { role, name, description: "", states: {}, properties: {} },
      dom: { tagName: "button", attributes: {}, textContent: name },
      interaction: {
        actions,
        isEditable: false,
        isFocusable: actions.length > 0,
      },
      ui: { expanded: true, selected: false, matchesFilter: true },
    } as unknown as SemanticNode,
  ];

  return {
    type: "TREE_DATA",
    tabId: TAB_ID,
    payload: {
      nodes: [
        mk("n1", null, 0, "document", "Page", ["n2"], []),
        mk("n2", "n1", 1, "button", "Save", [], ["click"]),
      ],
      rootId: "n1",
      pageTitle: "Test page",
      pageUrl: "https://example.test/",
    },
  } as unknown as ContentToPanel;
}

describe("panel action feedback: a frame that refuses", () => {
  let container: HTMLDivElement;
  let chromeMock: ChromeMock;

  /** Let the promise-form replies land and the effects they trigger run. */
  async function flush(): Promise<void> {
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        await Promise.resolve();
      });
    }
  }

  /** The panel on the TAB view, its one stop listed. */
  async function mount(
    respond?: (m: PanelToContent) => unknown,
  ): Promise<void> {
    chromeMock = installChromeMock(respond ? { respond } : {});
    act(() => {
      render(h(App, {}), container);
    });
    act(() => {
      chromeMock.emit({
        type: "ACTIVE_TAB_CHANGED",
        tabId: TAB_ID,
      } as unknown as ContentToPanel);
    });
    act(() => {
      chromeMock.emit(actionableTree());
    });
    await flush();
    const tab = [...container.querySelectorAll("button.sn-toggle-btn")].find(
      (b) => b.textContent?.trim() === "TAB",
    ) as HTMLButtonElement | undefined;
    if (!tab) throw new Error("no TAB toggle rendered");
    act(() => tab.click());
    // The page sends its whole tree for the TAB view.
    act(() => {
      chromeMock.emit(actionableTree());
    });
    await flush();
  }

  function feedback(): string {
    return (
      container
        .querySelector(".sn-action-feedback-text")
        ?.textContent?.trim() ?? ""
    );
  }

  function clickAction(): void {
    const btn = [
      ...container.querySelectorAll("button.sn-list-action-btn"),
    ].find((b) => b.textContent?.trim() === "Activate") as
      HTMLButtonElement | undefined;
    if (!btn || btn.disabled) throw new Error("no Activate button for Save");
    act(() => {
      btn.click();
    });
  }

  const scrollIntoView = Element.prototype.scrollIntoView;

  beforeEach(() => {
    vi.useFakeTimers();
    stubMatchMedia();
    // jsdom has no scrollIntoView, which the TAB list calls to keep its
    // selected stop in view.
    Element.prototype.scrollIntoView = () => {};
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    container.remove();
    vi.useRealTimers();
    Element.prototype.scrollIntoView = scrollIntoView;
    delete (globalThis as { chrome?: unknown }).chrome;
  });

  it("does not let an earlier action's timer clear a later message", async () => {
    let refuse = false;
    await mount((m) =>
      m.type === "DISPATCH_ACTION" && refuse
        ? { success: false, error: ERROR }
        : undefined,
    );

    // "Click: Save" succeeds and arms a 2s clear.
    clickAction();
    expect(feedback()).toBe("Click: Save");

    // A second later a refusal puts up its own 3s message.
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    refuse = true;
    clickAction();
    expect(feedback()).toBe(`Failed: ${ERROR}`);

    // The first action's clear is now due. It must not take this one with it.
    act(() => {
      vi.advanceTimersByTime(1100);
    });
    expect(feedback()).toBe(`Failed: ${ERROR}`);
  });

  it("reports the refusal instead of the optimistic banner", async () => {
    await mount((m) =>
      m.type === "DISPATCH_ACTION"
        ? { success: false, error: ERROR }
        : undefined,
    );

    clickAction();

    expect(feedback()).toBe(`Failed: ${ERROR}`);
  });

  it("keeps the refusal on screen past the optimistic banner's own clear", async () => {
    await mount((m) =>
      m.type === "DISPATCH_ACTION"
        ? { success: false, error: ERROR }
        : undefined,
    );

    clickAction();

    // The optimistic "Click: Save" set a 2s clear before the reply arrived.
    // Left running, it wipes the failure at 2s — well short of its own 3s.
    act(() => {
      vi.advanceTimersByTime(2100);
    });
    expect(feedback()).toBe(`Failed: ${ERROR}`);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(feedback()).toBe("");
  });

  it("still reports success when the frame accepts the action", async () => {
    await mount();

    clickAction();

    // The optimistic banner is correct here — the page really did act.
    expect(feedback()).toBe("Click: Save");
  });
});
