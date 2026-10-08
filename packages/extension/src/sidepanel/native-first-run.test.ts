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
 *
 * Each window has its own side panel, so every open panel follows the
 * setting in storage: an answer given in one window holds in the others.
 */

type FlagReply = { enabled?: boolean; chosen?: boolean };

const SETTING = "settings.nativeModeEnabled";

describe("native mode on first run", () => {
  let container: HTMLDivElement;
  let chromeMock: ChromeMock;

  function mount(
    flag: FlagReply,
    options: {
      /** Extension storage, for the panel to follow the setting in. */
      storage?: Record<string, unknown>;
      /** The service worker's answer to "keep the DOM tree". */
      decline?: FlagReply;
    } = {},
  ): void {
    chromeMock = installChromeMock({
      storage: options.storage,
      respond: (message) => {
        const m = message as unknown as { type: string; enabled?: boolean };
        if (m.type === "NATIVE_FLAG_GET") return flag;
        if (m.type === "NATIVE_FLAG_SET") {
          return { enabled: m.enabled, detached: 0 };
        }
        if (m.type === "NATIVE_FLAG_DECLINE") {
          return options.decline ?? { enabled: false, chosen: true };
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

  /** Another window's panel, or the service worker, writes the setting. */
  async function answeredElsewhere(value: boolean): Promise<void> {
    act(() => chromeMock.writeStorage({ [SETTING]: value }));
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

  /** A toolbar control outside the question, by its text; null if absent. */
  const toolbarButton = (name: string) =>
    [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => b.textContent?.trim() === name && !question()?.contains(b),
    ) ?? null;

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
    // Its own message, not a Disable: see the service worker's handler.
    expect(sentOfType("NATIVE_FLAG_DECLINE")).toHaveLength(1);
    expect(sentOfType("NATIVE_FLAG_SET")).toEqual([]);
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
    expect(sentOfType("NATIVE_FLAG_DECLINE")).toHaveLength(1);
    expect(sentOfType("NATIVE_FLAG_SET")).toEqual([]);
    expect(sentOfType("NATIVE_READ")).toEqual([]);
  });

  it("puts focus on Enable native mode… after keeping the DOM tree", async () => {
    // The question opened by itself, with nothing in the panel focused, so
    // there is no opener to return focus to.
    mount({ enabled: false, chosen: false });
    await flush();
    await showTab(7);

    act(() => button("Keep the DOM tree").click());
    await flush();

    expect(document.activeElement).toBe(toolbarButton("Enable native mode…"));
  });

  it("keeps native mode on when another window's yes got there first", async () => {
    mount(
      { enabled: false, chosen: false },
      { decline: { enabled: true, chosen: true } },
    );
    await flush();
    await showTab(7);

    act(() => button("Keep the DOM tree").click());
    await flush();

    // This window stays on the DOM tree, and reads nothing natively, but
    // the toolbar now offers NATIVE rather than a turn-on that isn't needed.
    expect(toolbarButton("NATIVE")).not.toBeNull();
    expect(toolbarButton("Enable native mode…")).toBeNull();
    expect(sentOfType("NATIVE_FLAG_SET")).toEqual([]);
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

  describe("an answer given in another window", () => {
    it("closes the question this panel asked by itself, on a yes", async () => {
      mount({ enabled: false, chosen: false }, { storage: {} });
      await flush();
      await showTab(7);
      expect(question()).not.toBeNull();

      await answeredElsewhere(true);

      expect(question()).toBeNull();
      // Focus was in the question, so it goes to what replaced it.
      expect(document.activeElement).toBe(toolbarButton("NATIVE"));
      // This panel was already showing a page: no gesture here, no read.
      expect(sentOfType("NATIVE_READ")).toEqual([]);
      expect(sentOfType("NATIVE_FLAG_SET")).toEqual([]);
      expect(sentOfType("NATIVE_FLAG_DECLINE")).toEqual([]);
    });

    it("closes the question this panel asked by itself, on a no", async () => {
      mount({ enabled: false, chosen: false }, { storage: {} });
      await flush();
      await showTab(7);

      await answeredElsewhere(false);

      expect(question()).toBeNull();
      expect(document.activeElement).toBe(toolbarButton("Enable native mode…"));
      expect(sentOfType("NATIVE_FLAG_DECLINE")).toEqual([]);
    });

    it("leaves open a question the user opened here with Enable native mode…", async () => {
      mount(
        { enabled: false, chosen: true },
        { storage: { [SETTING]: false } },
      );
      await flush();
      await showTab(7);
      act(() => toolbarButton("Enable native mode…")!.click());
      await flush();
      expect(question()).not.toBeNull();

      // Rewritten as off elsewhere: not an answer to what was asked here.
      await answeredElsewhere(false);
      expect(question()).not.toBeNull();
    });

    it("stops a panel that hasn't connected yet from asking at all", async () => {
      mount({ enabled: false, chosen: false }, { storage: {} });
      await flush();

      await answeredElsewhere(false);
      await showTab(7);

      expect(question()).toBeNull();
    });

    it("lets a panel that hasn't connected yet read its first page natively", async () => {
      // As a panel opened with native mode already on would.
      mount({ enabled: false, chosen: false }, { storage: {} });
      await flush();

      await answeredElsewhere(true);
      await showTab(7);

      expect(question()).toBeNull();
      expect(sentOfType("NATIVE_READ").length).toBeGreaterThan(0);
    });

    it("returns this panel to the DOM tree when native mode is turned off", async () => {
      mount({ enabled: true, chosen: true }, { storage: { [SETTING]: true } });
      await flush();
      await showTab(7);
      expect(toolbarButton("Disable native mode")).not.toBeNull();

      await answeredElsewhere(false);

      expect(toolbarButton("Disable native mode")).toBeNull();
      expect(toolbarButton("Enable native mode…")).not.toBeNull();
      expect(question()).toBeNull();
    });
  });
});
