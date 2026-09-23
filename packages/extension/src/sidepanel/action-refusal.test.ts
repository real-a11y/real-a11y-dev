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
 * which is how it reports that the page is in a state the action cannot run
 * in, pick mode being the case that exists — still read as done.
 */

const ERROR = "Turn off pick mode to act on the page";

/** A one-button tree whose row actually offers a click action. */
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
      interaction: { actions, isEditable: false, focusable: true },
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

  function mount(respond?: (m: PanelToContent) => unknown): void {
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
  }

  function feedback(): string {
    return (
      container
        .querySelector(".sn-action-feedback-text")
        ?.textContent?.trim() ?? ""
    );
  }

  function clickAction(): void {
    const btn = container.querySelector(
      '[data-node-id="n2"] button.sn-action',
    ) as HTMLButtonElement | null;
    if (!btn) throw new Error("no action button rendered for n2");
    act(() => {
      btn.click();
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    stubMatchMedia();
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    container.remove();
    vi.useRealTimers();
    delete (globalThis as { chrome?: unknown }).chrome;
  });

  it("disarms every frame in the tab when one of them resolves a pick", () => {
    mount();
    chromeMock.sent.length = 0;

    act(() => {
      chromeMock.emit({
        type: "NODE_PICKED",
        tabId: TAB_ID,
        payload: { nodeId: "n2" },
      } as unknown as ContentToPanel);
    });

    // Only the frame that resolved the click exits on its own. Without this
    // the other frames stay armed while the ⦿ button reads off, swallowing
    // clicks with no visible control to turn back off.
    expect(
      chromeMock.sent.filter(
        (m) =>
          m.type === "SET_PICK_MODE" &&
          (m.payload as { enabled: boolean }).enabled === false,
      ),
    ).toHaveLength(1);
  });

  // Escape, and a click that lands on nothing tracked, both exit the picker
  // WITHOUT a NODE_PICKED — PICK_MODE_CHANGED is the only notice the panel
  // gets. Handling just the pick path leaves sibling frames armed.
  it("disarms every frame when one reports itself out of pick mode", () => {
    mount();
    chromeMock.sent.length = 0;

    act(() => {
      chromeMock.emit({
        type: "PICK_MODE_CHANGED",
        tabId: TAB_ID,
        payload: { enabled: false },
      } as unknown as ContentToPanel);
    });

    expect(
      chromeMock.sent.filter(
        (m) =>
          m.type === "SET_PICK_MODE" &&
          (m.payload as { enabled: boolean }).enabled === false,
      ),
    ).toHaveLength(1);
  });

  it("does not let an earlier action's timer clear a later message", () => {
    let refuse = false;
    mount((m) =>
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

  it("reports the refusal instead of the optimistic banner", () => {
    mount((m) =>
      m.type === "DISPATCH_ACTION"
        ? { success: false, error: ERROR }
        : undefined,
    );

    clickAction();

    expect(feedback()).toBe(`Failed: ${ERROR}`);
  });

  it("keeps the refusal on screen past the optimistic banner's own clear", () => {
    mount((m) =>
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

  it("still reports success when the frame accepts the action", () => {
    mount();

    clickAction();

    // The optimistic banner is correct here — the page really did act.
    expect(feedback()).toBe("Click: Save");
  });
});
