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
      /** Extension storage, for the panel to follow the setting in. With it,
       *  NATIVE_FLAG_GET answers from storage rather than from `flag`. */
      storage?: Record<string, unknown>;
      /** Plays the service worker for "keep the DOM tree": its reply, or a
       *  function that writes and then replies. */
      decline?: FlagReply | (() => unknown);
      /** Plays the service worker for NATIVE_FLAG_SET: what it writes, and
       *  its reply (a promise, to hold the reply back). */
      set?: (enabled: boolean) => unknown;
      /** The reply to the mount-time NATIVE_FLAG_GET, overriding `flag`
       *  (a promise, to hold it back). */
      get?: () => unknown;
    } = {},
  ): void {
    chromeMock = installChromeMock({
      storage: options.storage,
      respond: (message) => {
        const m = message as unknown as { type: string; enabled?: boolean };
        if (m.type === "NATIVE_FLAG_GET") {
          if (options.get) return options.get();
          if (!options.storage) return flag;
          const value = chromeMock.stored[SETTING];
          return {
            enabled: value === true,
            chosen: typeof value === "boolean",
          };
        }
        if (m.type === "NATIVE_FLAG_SET") {
          if (options.set) return options.set(m.enabled === true);
          return { enabled: m.enabled, detached: 0 };
        }
        if (m.type === "NATIVE_FLAG_DECLINE") {
          if (typeof options.decline === "function") return options.decline();
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

  /** What the panel last announced in its feedback bar. */
  const announced = () =>
    container.querySelector(".sn-action-feedback-text")?.textContent ?? "";

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

    it("reads nothing in a panel between pages, when the next page connects", async () => {
      // The panel has shown a page; the tab is now navigating, so nothing is
      // connected at the moment the other window says yes.
      mount(
        { enabled: false, chosen: true },
        { storage: { [SETTING]: false } },
      );
      await flush();
      await showTab(7);
      act(() => {
        chromeMock.emit({
          type: "PAGE_NAVIGATED",
          tabId: 7,
        } as unknown as ContentToPanel);
      });
      await flush();

      await answeredElsewhere(true);
      act(() => {
        chromeMock.emit({ ...treeData(), tabId: 7 } as ContentToPanel);
      });
      await flush();

      expect(toolbarButton("NATIVE")).not.toBeNull();
      expect(sentOfType("NATIVE_READ")).toEqual([]);
    });

    it("leaves an armed DOM pick alone when native mode is turned off", async () => {
      mount({ enabled: true, chosen: true }, { storage: { [SETTING]: true } });
      await flush();
      // The native default can't read this page (the stub refuses it), so
      // the panel stays on the DOM tree.
      await showTab(7);
      const pick = () =>
        container.querySelector<HTMLButtonElement>(
          'button[aria-label="Pick element in page"]',
        );
      act(() => pick()!.click());
      await flush();
      expect(pick()!.getAttribute("aria-pressed")).toBe("true");

      await answeredElsewhere(false);

      // The content script's picker is still armed on the page, so the
      // button says so; nothing told the page to stop.
      expect(pick()!.getAttribute("aria-pressed")).toBe("true");
      expect(
        sentOfType("SET_PICK_MODE").map(
          (m) => (m as unknown as { payload: { enabled: boolean } }).payload,
        ),
      ).toEqual([{ enabled: true }]);
    });

    it("leaves focus where it was when what had it survives the change", async () => {
      mount(
        { enabled: false, chosen: true },
        { storage: { [SETTING]: false } },
      );
      await flush();
      await showTab(7);
      const search = container.querySelector<HTMLInputElement>(
        'input[aria-label="Search tree nodes"]',
      )!;
      act(() => search.focus());

      await answeredElsewhere(true);

      expect(toolbarButton("NATIVE")).not.toBeNull();
      expect(document.activeElement).toBe(search);
    });

    it("leaves open a question opened before the panel knew to ask by itself", async () => {
      // The mount-time read answers late, after the user has already opened
      // the question from the toolbar on a connected page.
      let answerRead = () => {};
      mount(
        { enabled: false, chosen: false },
        {
          storage: {},
          get: () =>
            new Promise((resolve) => {
              answerRead = () => resolve({ enabled: false, chosen: false });
            }),
        },
      );
      await flush();
      await showTab(7);
      act(() => toolbarButton("Enable native mode…")!.click());
      await flush();
      expect(question()).not.toBeNull();

      answerRead();
      await flush();
      // Still the user's own question, so another window's "no" leaves it.
      await answeredElsewhere(false);
      expect(question()).not.toBeNull();
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

  describe("this panel's own answer", () => {
    it("isn't closed under 'Turning on…' by its own echo, landing before the reply", async () => {
      let release = () => {};
      mount(
        { enabled: false, chosen: false },
        {
          storage: {},
          set: (enabled) => {
            // The service worker stores the answer, and storage tells every
            // panel, this one included, before the reply gets here.
            chromeMock.writeStorage({ [SETTING]: enabled });
            return new Promise((resolve) => {
              release = () => resolve({ enabled, detached: 0 });
            });
          },
        },
      );
      await flush();
      await showTab(7);

      act(() => button("Use native mode").click());
      await flush();
      // Still waiting on its own reply: the question stays, saying so.
      expect(question()).not.toBeNull();
      expect(question()?.querySelector("button")?.textContent?.trim()).toBe(
        "Turning on…",
      );
      expect(sentOfType("NATIVE_READ")).toEqual([]);

      release();
      await flush();
      expect(question()).toBeNull();
      expect(sentOfType("NATIVE_READ").length).toBeGreaterThan(0);
    });

    it("doesn't lose another window's answer that lands while its own is on its way", async () => {
      mount(
        { enabled: true, chosen: true },
        {
          storage: { [SETTING]: true },
          set: (enabled) => {
            // This panel's Disable is stored and echoed; before its reply
            // gets here, another window's panel says yes again.
            chromeMock.writeStorage({ [SETTING]: enabled });
            chromeMock.writeStorage({ [SETTING]: true });
            return { enabled, detached: 0 };
          },
        },
      );
      await flush();
      await showTab(7);

      act(() => toolbarButton("Disable native mode")!.click());
      await flush();

      // The setting is on, and this panel agrees, and says so last.
      expect(chromeMock.stored[SETTING]).toBe(true);
      expect(toolbarButton("Enable native mode…")).toBeNull();
      expect(toolbarButton("NATIVE")).not.toBeNull();
      expect(announced()).toBe(
        "Native mode is on — NATIVE in the toolbar reads Chromium's tree.",
      );
      // Applied from what storage reported, in order: no second read whose
      // late reply could overwrite a newer change.
      expect(sentOfType("NATIVE_FLAG_GET")).toHaveLength(1);
    });

    it("ends off, on the DOM tree, when another window says no while its own yes is on its way", async () => {
      mount(
        { enabled: false, chosen: false },
        {
          storage: {},
          set: (enabled) => {
            chromeMock.writeStorage({ [SETTING]: enabled });
            chromeMock.writeStorage({ [SETTING]: false });
            return { enabled, detached: 0 };
          },
        },
      );
      await flush();
      await showTab(7);

      act(() => button("Use native mode").click());
      await flush();

      expect(chromeMock.stored[SETTING]).toBe(false);
      expect(toolbarButton("Enable native mode…")).not.toBeNull();
      expect(toolbarButton("NATIVE")).toBeNull();
      // The DOM tree's own controls are back, so the view really is DOM.
      expect(
        container.querySelector('input[aria-label="Search tree nodes"]'),
      ).not.toBeNull();
      expect(announced()).toBe("Native mode off — showing the DOM tree.");
    });

    it("isn't left waiting by a send that throws, and still follows other windows", async () => {
      mount(
        { enabled: false, chosen: false },
        {
          storage: {},
          set: () => {
            // A torn-down context throws rather than rejecting.
            throw new Error("Extension context invalidated.");
          },
        },
      );
      await flush();
      await showTab(7);

      act(() => button("Use native mode").click());
      await flush();

      // Not stuck on "Turning on…": the failure is said, and both answers
      // work again.
      expect(question()?.textContent).toContain(
        "Couldn't enable native mode — try again.",
      );
      expect(button("Use native mode").getAttribute("aria-disabled")).toBe(
        "false",
      );
      // And a later answer from another window still reaches this panel.
      await answeredElsewhere(true);
      expect(question()).toBeNull();
      expect(toolbarButton("NATIVE")).not.toBeNull();
    });

    it("isn't left holding by a 'keep the DOM tree' whose send throws", async () => {
      mount(
        { enabled: false, chosen: false },
        {
          storage: {},
          decline: () => {
            throw new Error("Extension context invalidated.");
          },
        },
      );
      await flush();
      await showTab(7);

      act(() => button("Keep the DOM tree").click());
      await flush();

      expect(question()).toBeNull();
      expect(announced()).toBe(
        "Keeping the DOM tree. Enable native mode… in the toolbar turns it on.",
      );
      // Its write is over, so another window's answer still reaches it.
      await answeredElsewhere(true);
      expect(toolbarButton("NATIVE")).not.toBeNull();
    });

    it("leaves focus where the user moved it while its own Disable was on its way", async () => {
      let release = () => {};
      mount(
        { enabled: true, chosen: true },
        {
          storage: { [SETTING]: true },
          set: (enabled) => {
            chromeMock.writeStorage({ [SETTING]: enabled });
            // The reply waits, as it does behind a native read in flight.
            return new Promise((resolve) => {
              release = () => resolve({ enabled, detached: 0 });
            });
          },
        },
      );
      await flush();
      await showTab(7);

      act(() => {
        toolbarButton("Disable native mode")!.focus();
        toolbarButton("Disable native mode")!.click();
      });
      await flush();
      const search = container.querySelector<HTMLInputElement>(
        'input[aria-label="Search tree nodes"]',
      )!;
      act(() => search.focus());

      release();
      await flush();

      expect(toolbarButton("Enable native mode…")).not.toBeNull();
      expect(document.activeElement).toBe(search);
    });

    it("doesn't lose another window's yes that lands while keeping the DOM tree", async () => {
      mount(
        { enabled: false, chosen: false },
        {
          storage: {},
          decline: () => {
            // The "no" is stored and echoed; before its reply gets here,
            // another window's panel says yes.
            chromeMock.writeStorage({ [SETTING]: false });
            chromeMock.writeStorage({ [SETTING]: true });
            return { enabled: false, chosen: true };
          },
        },
      );
      await flush();
      await showTab(7);

      act(() => button("Keep the DOM tree").click());
      await flush();

      expect(chromeMock.stored[SETTING]).toBe(true);
      expect(toolbarButton("Enable native mode…")).toBeNull();
      expect(toolbarButton("NATIVE")).not.toBeNull();
      // Nobody pressed anything native in this window, which has shown a page.
      expect(sentOfType("NATIVE_READ")).toEqual([]);
    });
  });
});
