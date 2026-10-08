import { render, h } from "preact";
import { act } from "preact/test-utils";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import type { ContentToPanel } from "../types.js";

import { App } from "./App.js";
import type { ChromeMock } from "./panel-harness.js";
import {
  installChromeMock,
  stubMatchMedia,
  treeData,
} from "./panel-harness.js";

/**
 * Native mode is the suggested default: the first time a page connects while
 * the user has never answered the question, the panel asks by itself, before
 * anything attaches, with native mode as the answer offered first. Either
 * answer is remembered, so a user who keeps the DOM tree isn't asked again.
 */

type FlagReply = { enabled?: boolean; chosen?: boolean };

describe("native mode on first run", () => {
  let container: HTMLDivElement;
  let chromeMock: ChromeMock;

  function mount(flag: FlagReply): void {
    chromeMock = installChromeMock({
      respond: (message) => {
        const m = message as unknown as { type: string; enabled?: boolean };
        if (m.type === "NATIVE_FLAG_GET") return flag;
        if (m.type === "NATIVE_FLAG_SET") {
          return { enabled: m.enabled, detached: 0 };
        }
        if (m.type === "NATIVE_READ") {
          return { ok: false, error: "unavailable", reason: "browser-ui" };
        }
        return undefined;
      },
    });
    act(() => {
      render(h(App, {}), container);
    });
  }

  beforeEach(() => {
    stubMatchMedia();
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    container.remove();
  });

  /** Let the promise-form replies land and the effects they trigger run. */
  async function flush(): Promise<void> {
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        await Promise.resolve();
      });
    }
  }

  /** The panel's bound tab becomes `tabId`, and its page connects. */
  async function showTab(tabId: number): Promise<void> {
    act(() => {
      chromeMock.emit({
        type: "ACTIVE_TAB_CHANGED",
        tabId,
      } as unknown as ContentToPanel);
    });
    act(() => {
      chromeMock.emit({ ...treeData(), tabId } as ContentToPanel);
    });
    await flush();
  }

  const question = () =>
    container.querySelector<HTMLElement>(
      '[role="dialog"][aria-label="Native mode"]',
    );

  function button(name: string): HTMLButtonElement {
    const found = [
      ...(question()?.querySelectorAll<HTMLButtonElement>("button") ?? []),
    ].find((b) => b.textContent?.trim() === name);
    if (!found) throw new Error(`no "${name}" button in the question`);
    return found;
  }

  const sentOfType = (type: string) =>
    chromeMock.sent
      .map((m) => m as unknown as { type: string; enabled?: boolean })
      .filter((m) => m.type === type);

  it("asks on the first connect, with native mode focused, before any read", async () => {
    mount({ enabled: false, chosen: false });
    await flush();
    // No page yet: nothing to ask about.
    expect(question()).toBeNull();

    await showTab(7);
    expect(question()).not.toBeNull();
    expect(document.activeElement).toBe(button("Use native mode"));
    expect(sentOfType("NATIVE_READ")).toEqual([]);
  });

  it("describes itself with what it asks, for a screen reader", async () => {
    mount({ enabled: false, chosen: false });
    await flush();
    await showTab(7);

    // Focus lands on a button, so the explanation reaches a screen reader
    // only as the dialog's description.
    const ids = question()?.getAttribute("aria-describedby")?.split(" ") ?? [];
    const description = ids
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ");
    expect(description).toContain("started debugging this browser");
    expect(description).toContain("Or keep the DOM tree");
  });

  it("turns native mode on and reads the page when the user says yes", async () => {
    mount({ enabled: false, chosen: false });
    await flush();
    await showTab(7);

    act(() => button("Use native mode").click());
    await flush();

    expect(sentOfType("NATIVE_FLAG_SET")).toEqual([
      { type: "NATIVE_FLAG_SET", enabled: true },
    ]);
    expect(question()).toBeNull();
    expect(sentOfType("NATIVE_READ").length).toBeGreaterThan(0);
  });

  it("remembers keeping the DOM tree, and doesn't ask again", async () => {
    mount({ enabled: false, chosen: false });
    await flush();
    await showTab(7);

    act(() => button("Keep the DOM tree").click());
    await flush();

    expect(question()).toBeNull();
    expect(sentOfType("NATIVE_FLAG_SET")).toEqual([
      { type: "NATIVE_FLAG_SET", enabled: false },
    ]);
    await showTab(8);
    expect(question()).toBeNull();
    expect(sentOfType("NATIVE_READ")).toEqual([]);
  });

  it("answers Escape as keeping the DOM tree", async () => {
    mount({ enabled: false, chosen: false });
    await flush();
    await showTab(7);

    act(() => {
      button("Use native mode").dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    await flush();

    expect(question()).toBeNull();
    expect(sentOfType("NATIVE_FLAG_SET")).toEqual([
      { type: "NATIVE_FLAG_SET", enabled: false },
    ]);
    expect(sentOfType("NATIVE_READ")).toEqual([]);
  });

  it("doesn't ask a user who already chose the DOM tree", async () => {
    mount({ enabled: false, chosen: true });
    await flush();
    await showTab(7);
    expect(question()).toBeNull();
  });

  it("doesn't ask when the reply can't tell 'never asked' from 'said no'", async () => {
    mount({ enabled: false });
    await flush();
    await showTab(7);
    expect(question()).toBeNull();
  });
});
