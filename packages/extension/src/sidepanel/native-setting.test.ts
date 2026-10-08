import { render, h } from "preact";
import { act } from "preact/test-utils";
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  onTestFinished,
} from "vitest";

import type { ContentToPanel } from "../types.js";

import { App } from "./App.js";
import type { ChromeMock } from "./panel-harness.js";
import {
  installChromeMock,
  stubMatchMedia,
  treeData,
} from "./panel-harness.js";

/**
 * Native mode is on by default: the panel reads the first page natively with
 * nothing asked first, explains Chrome's debugging bar in a note the first
 * time the native tree shows, and turns off from Settings (or the note).
 *
 * Each window has its own side panel, so every open panel follows the
 * setting in storage: a change made in one window holds in the others.
 */

const SETTING = "settings.nativeModeEnabled";
const NOTICE_SEEN = "settings.nativeNoticeSeen";

/** A native read that succeeds, so the native tree stays on screen. */
const NATIVE_TREE = {
  ok: true,
  nodes: [
    {
      id: "r1",
      role: "RootWebArea",
      name: "Test page",
      depth: 0,
      childIds: [],
      states: {},
      properties: {},
    },
  ],
  rootId: "r1",
  url: "https://example.test/",
  documentId: "doc-1",
};

/** A native read with a heading in it, for the role filter's list. */
const NATIVE_TREE_WITH_HEADING = {
  ...NATIVE_TREE,
  nodes: [
    { ...NATIVE_TREE.nodes[0], childIds: ["h1"] },
    {
      id: "h1",
      role: "heading",
      name: "Welcome",
      depth: 1,
      childIds: [],
      states: {},
      properties: { level: 1 },
    },
  ],
};

/** A native read that can't happen here, so the panel stays on DOM. */
const NATIVE_REFUSED = {
  ok: false,
  error: "unavailable",
  reason: "devtools-conflict",
};

describe("native mode on by default", () => {
  let container: HTMLDivElement;
  let chromeMock: ChromeMock;

  function mount(
    options: {
      /** Extension storage, for the panel to follow the setting in, and to
       *  keep whether the note was acknowledged. */
      storage?: Record<string, unknown>;
      /** The mount-time NATIVE_FLAG_GET reply, without storage. */
      enabled?: boolean;
      /** Plays the service worker for NATIVE_FLAG_GET instead (a promise, to
       *  hold the reply back, or a rejection). */
      get?: () => unknown;
      /** What a native read answers, or a function of the tab it reads. */
      read?: unknown;
      /** Plays the service worker for NATIVE_FLAG_SET: what it writes, and
       *  its reply (a promise, to hold the reply back). */
      set?: (enabled: boolean) => unknown;
    } = {},
  ): void {
    chromeMock = installChromeMock({
      storage: options.storage,
      respond: (message) => {
        const m = message as unknown as { type: string; enabled?: boolean };
        if (m.type === "NATIVE_FLAG_GET") {
          if (options.get) return options.get();
          if (!options.storage) return { enabled: options.enabled ?? true };
          return { enabled: chromeMock.stored[SETTING] !== false };
        }
        if (m.type === "NATIVE_FLAG_SET") {
          if (options.set) return options.set(m.enabled === true);
          if (options.storage) {
            chromeMock.writeStorage({ [SETTING]: m.enabled });
          }
          return { enabled: m.enabled, detached: 0 };
        }
        if (m.type === "NATIVE_READ") {
          const read = options.read ?? NATIVE_REFUSED;
          return typeof read === "function"
            ? (read as (tabId: number) => unknown)(
                (message as unknown as { tabId: number }).tabId,
              )
            : read;
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

  /** Another window's panel, or the service worker, writes storage. */
  async function writtenElsewhere(items: Record<string, unknown>) {
    act(() => chromeMock.writeStorage(items));
    await flush();
  }

  const note = () =>
    container.querySelector<HTMLElement>(
      '[role="note"][aria-label="About Chrome\'s debugging bar"]',
    );

  /** A button by its text; null if absent. */
  const buttonNamed = (name: string) =>
    [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => b.textContent?.trim() === name,
    ) ?? null;

  const settingsCheckbox = () =>
    container.querySelector<HTMLInputElement>(
      '[role="group"][aria-label="Settings"] input[type="checkbox"]',
    );

  async function openSettings(): Promise<HTMLInputElement> {
    act(() => buttonNamed("Settings ▾")!.click());
    await flush();
    return settingsCheckbox()!;
  }

  /** What the panel last announced in its feedback bar. */
  const announced = () =>
    container.querySelector(".sn-action-feedback-text")?.textContent ?? "";

  const sentOfType = (type: string) =>
    chromeMock.sent
      .map((m) => m as unknown as { type: string; enabled?: boolean })
      .filter((m) => m.type === type);

  const searchBox = () =>
    container.querySelector<HTMLInputElement>(
      'input[aria-label="Search tree nodes"]',
    );

  it("reads the first page natively, with nothing asked first", async () => {
    mount();
    await flush();
    await showTab(7);

    expect(sentOfType("NATIVE_READ").length).toBeGreaterThan(0);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  describe("the note about Chrome's debugging bar", () => {
    it("shows with the native tree, and is said once", async () => {
      mount({ storage: {}, read: NATIVE_TREE });
      await flush();
      await showTab(7);

      expect(note()).not.toBeNull();
      expect(note()?.textContent).toContain("started debugging this browser");
      expect(announced()).toContain("started debugging this browser");
    });

    it("goes for good with Got it, in every window", async () => {
      mount({ storage: {}, read: NATIVE_TREE });
      await flush();
      await showTab(7);

      act(() => buttonNamed("Got it")!.click());
      await flush();

      expect(note()).toBeNull();
      expect(chromeMock.stored[NOTICE_SEEN]).toBe(true);
      // Its button went with it, so focus moves to the tree.
      expect(document.activeElement?.getAttribute("role")).toBe("tree");
    });

    it("doesn't show once acknowledged", async () => {
      mount({ storage: { [NOTICE_SEEN]: true }, read: NATIVE_TREE });
      await flush();
      await showTab(7);

      expect(note()).toBeNull();
    });

    it("closes here when acknowledged in another window", async () => {
      mount({ storage: {}, read: NATIVE_TREE });
      await flush();
      await showTab(7);
      expect(note()).not.toBeNull();

      await writtenElsewhere({ [NOTICE_SEEN]: true });

      expect(note()).toBeNull();
    });

    it("turns native mode off with Turn off", async () => {
      mount({ storage: {}, read: NATIVE_TREE });
      await flush();
      await showTab(7);

      act(() => buttonNamed("Turn off")!.click());
      await flush();

      expect(sentOfType("NATIVE_FLAG_SET")).toEqual([
        { type: "NATIVE_FLAG_SET", enabled: false },
      ]);
      expect(note()).toBeNull();
      expect(buttonNamed("NATIVE")).toBeNull();
      expect(searchBox()).not.toBeNull();
      expect(chromeMock.stored[NOTICE_SEEN]).toBe(true);
      expect(announced()).toBe(
        "Not reading pages through Chrome — showing the DOM tree.",
      );
    });

    it("doesn't show with the DOM tree", async () => {
      // The native read fails, so the panel stays on DOM: no bar, no note.
      mount({ storage: {}, read: NATIVE_REFUSED });
      await flush();
      await showTab(7);

      expect(note()).toBeNull();
    });

    it("waits for a read that succeeds, and is said then", async () => {
      // DevTools holds the first tab, so its read fails and no bar shows;
      // the next tab's read succeeds.
      mount({
        storage: {},
        read: (tabId: number) => (tabId === 7 ? NATIVE_REFUSED : NATIVE_TREE),
      });
      await flush();
      await showTab(7);
      expect(note()).toBeNull();
      expect(announced()).not.toContain("started debugging this browser");

      await showTab(8);

      expect(note()).not.toBeNull();
      expect(announced()).toContain("started debugging this browser");
    });

    it("moves focus to the tree when it closes from another window", async () => {
      mount({ storage: {}, read: NATIVE_TREE });
      await flush();
      await showTab(7);
      act(() => buttonNamed("Got it")!.focus());

      await writtenElsewhere({ [NOTICE_SEEN]: true });

      expect(note()).toBeNull();
      expect(document.activeElement?.getAttribute("role")).toBe("tree");
    });

    it("stays, unacknowledged, when Turn off doesn't take", async () => {
      mount({ storage: {}, read: NATIVE_TREE, set: () => ({ ok: false }) });
      await flush();
      await showTab(7);

      act(() => buttonNamed("Turn off")!.click());
      await flush();

      expect(announced()).toBe("Couldn't change that setting — try again.");
      expect(note()).not.toBeNull();
      expect(chromeMock.stored[NOTICE_SEEN]).toBeUndefined();
    });

    it("puts focus on a native role filter's list when it goes", async () => {
      // jsdom has no scrollIntoView, which the list calls on its selection.
      const scrollIntoView = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = function () {};
      onTestFinished(() => {
        Element.prototype.scrollIntoView = scrollIntoView;
      });
      mount({ storage: {}, read: NATIVE_TREE_WITH_HEADING });
      await flush();
      await showTab(7);
      act(() => buttonNamed("Headings")!.click());
      await flush();
      expect(container.querySelector('[role="tree"]')).toBeNull();

      act(() => buttonNamed("Got it")!.click());
      await flush();

      expect(document.activeElement?.getAttribute("role")).toBe("listbox");
    });

    it("is answered by a Settings turn-off that Turn off can't add to", async () => {
      let release = () => {};
      mount({
        storage: {},
        read: NATIVE_TREE,
        set: (enabled) =>
          new Promise((resolve) => {
            release = () => {
              chromeMock.writeStorage({ [SETTING]: enabled });
              resolve({ enabled, detached: 0 });
            };
          }),
      });
      await flush();
      await showTab(7);
      // Turned off in Settings while the note is up, and slow to land, as
      // behind a read in flight. Meanwhile Turn off has nothing to add.
      const checkbox = await openSettings();
      act(() => checkbox.click());
      await flush();
      expect(buttonNamed("Turn off")!.getAttribute("aria-disabled")).toBe(
        "true",
      );
      act(() => buttonNamed("Turn off")!.click());
      await flush();
      expect(sentOfType("NATIVE_FLAG_SET")).toHaveLength(1);

      release();
      await flush();

      expect(note()).toBeNull();
      expect(chromeMock.stored[NOTICE_SEEN]).toBe(true);
    });

    it("isn't brought back by a read from before it was acknowledged", async () => {
      mount({ storage: {}, read: NATIVE_TREE });
      // Acknowledged in another window while this panel's own read of the
      // flag, taken before, is still on its way.
      act(() => chromeMock.writeStorage({ [NOTICE_SEEN]: true }));
      await flush();
      await showTab(7);

      expect(note()).toBeNull();
    });
  });

  describe("Settings", () => {
    it("turns native mode off, and back on with a read", async () => {
      mount({ storage: { [NOTICE_SEEN]: true }, read: NATIVE_TREE });
      await flush();
      await showTab(7);
      const checkbox = await openSettings();
      expect(checkbox.checked).toBe(true);

      act(() => checkbox.click());
      await flush();
      expect(settingsCheckbox()!.checked).toBe(false);
      expect(buttonNamed("NATIVE")).toBeNull();
      expect(chromeMock.stored[SETTING]).toBe(false);

      const readsBefore = sentOfType("NATIVE_READ").length;
      act(() => settingsCheckbox()!.click());
      await flush();
      expect(settingsCheckbox()!.checked).toBe(true);
      expect(buttonNamed("NATIVE")?.getAttribute("aria-pressed")).toBe("true");
      expect(sentOfType("NATIVE_READ").length).toBeGreaterThan(readsBefore);
      expect(announced()).toBe(
        "Reading pages through Chrome — showing its tree.",
      );
    });

    it("shows the change while it is stored, taking no other", async () => {
      let release = () => {};
      mount({
        storage: { [NOTICE_SEEN]: true },
        set: (enabled) =>
          new Promise((resolve) => {
            release = () => {
              chromeMock.writeStorage({ [SETTING]: enabled });
              resolve({ enabled, detached: 0 });
            };
          }),
      });
      await flush();
      await showTab(7);
      const checkbox = await openSettings();

      act(() => checkbox.click());
      await flush();
      expect(settingsCheckbox()!.checked).toBe(false);
      expect(settingsCheckbox()!.getAttribute("aria-disabled")).toBe("true");
      act(() => settingsCheckbox()!.click());
      await flush();
      expect(settingsCheckbox()!.checked).toBe(false);
      expect(sentOfType("NATIVE_FLAG_SET")).toHaveLength(1);

      release();
      await flush();
      expect(settingsCheckbox()!.checked).toBe(false);
      expect(settingsCheckbox()!.getAttribute("aria-disabled")).toBe("false");
    });

    it("sits in the header, not the toolbar, and opens as a disclosure", async () => {
      mount({ storage: { [NOTICE_SEEN]: true } });
      await flush();
      await showTab(7);
      const button = buttonNamed("Settings ▾")!;

      // The toolbar's controls don't wrap, and run past a narrow panel's
      // edge; the header's don't.
      expect(button.closest(".sn-page-header")).not.toBeNull();
      expect(button.closest('[role="toolbar"]')).toBeNull();
      // What it opens is a switch, not a menu.
      expect(button.hasAttribute("aria-haspopup")).toBe(false);
      await openSettings();
      const controls = button.getAttribute("aria-controls");
      expect(controls).not.toBeNull();
      expect(
        document.getElementById(controls!)?.getAttribute("aria-label"),
      ).toBe("Settings");
    });

    it("is there on a page with no title", async () => {
      mount({ storage: { [NOTICE_SEEN]: true } });
      await flush();
      act(() => {
        chromeMock.emit({
          type: "ACTIVE_TAB_CHANGED",
          tabId: 7,
        } as unknown as ContentToPanel);
      });
      const untitled = treeData() as unknown as {
        payload: { pageTitle: string };
      };
      untitled.payload.pageTitle = "";
      act(() => {
        chromeMock.emit({
          ...(untitled as unknown as ContentToPanel),
          tabId: 7,
        } as ContentToPanel);
      });
      await flush();

      expect(buttonNamed("Settings ▾")).not.toBeNull();
      expect(container.querySelector(".sn-page-title")?.textContent).toContain(
        "Untitled page",
      );
    });

    it("shows the stored setting when the service worker doesn't answer", async () => {
      mount({
        storage: { [NOTICE_SEEN]: true },
        get: () => Promise.reject(new Error("Receiving end does not exist.")),
      });
      await flush();
      await showTab(7);

      // Never touched, so on, as every other window has it.
      expect((await openSettings()).checked).toBe(true);
    });

    it("shows an off it can only read from storage", async () => {
      mount({
        storage: { [SETTING]: false, [NOTICE_SEEN]: true },
        get: () => ({ ok: false, error: "native mode error" }),
      });
      await flush();
      await showTab(7);

      expect((await openSettings()).checked).toBe(false);
      expect(sentOfType("NATIVE_READ")).toEqual([]);
    });

    it("says so when a change doesn't take, and leaves the setting", async () => {
      mount({
        storage: { [NOTICE_SEEN]: true },
        set: () => ({ ok: false }),
      });
      await flush();
      await showTab(7);

      const checkbox = await openSettings();
      act(() => checkbox.click());
      await flush();

      expect(announced()).toBe("Couldn't change that setting — try again.");
      expect(settingsCheckbox()!.checked).toBe(true);
    });

    it("closes on Escape, returning focus to its button", async () => {
      mount({ storage: { [NOTICE_SEEN]: true } });
      await flush();
      await showTab(7);
      const checkbox = await openSettings();
      act(() => checkbox.focus());

      act(() => {
        checkbox.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
      });
      await flush();

      expect(settingsCheckbox()).toBeNull();
      expect(document.activeElement).toBe(buttonNamed("Settings ▾"));
    });
  });

  describe("a change made in another window", () => {
    it("returns this panel to the DOM tree when native mode is turned off", async () => {
      mount({ storage: { [SETTING]: true, [NOTICE_SEEN]: true } });
      await flush();
      await showTab(7);
      expect(buttonNamed("NATIVE")).not.toBeNull();

      await writtenElsewhere({ [SETTING]: false });

      expect(buttonNamed("NATIVE")).toBeNull();
      expect(announced()).toBe(
        "Not reading pages through Chrome — showing the DOM tree.",
      );
    });

    it("moves focus to the tree when what had it goes away", async () => {
      mount({ storage: { [NOTICE_SEEN]: true } });
      await flush();
      await showTab(7);
      const producerToggle = () =>
        container.querySelector<HTMLButtonElement>(
          '[role="group"][aria-label="Tree producer"] button',
        );
      act(() => producerToggle()!.focus());

      await writtenElsewhere({ [SETTING]: false });

      expect(producerToggle()).toBeNull();
      expect(document.activeElement?.getAttribute("role")).toBe("tree");
    });

    it("leaves focus where it was when what had it survives the change", async () => {
      mount({ storage: { [SETTING]: false, [NOTICE_SEEN]: true } });
      await flush();
      await showTab(7);
      act(() => searchBox()!.focus());

      await writtenElsewhere({ [SETTING]: true });

      expect(buttonNamed("NATIVE")).not.toBeNull();
      expect(document.activeElement).toBe(searchBox());
    });

    it("doesn't read in a panel that has shown a page when it's turned on", async () => {
      mount({ storage: { [SETTING]: false, [NOTICE_SEEN]: true } });
      await flush();
      await showTab(7);

      await writtenElsewhere({ [SETTING]: true });

      expect(buttonNamed("NATIVE")).not.toBeNull();
      expect(sentOfType("NATIVE_READ")).toEqual([]);
    });

    it("reads nothing in a panel between pages, when the next page connects", async () => {
      mount({ storage: { [SETTING]: false, [NOTICE_SEEN]: true } });
      await flush();
      await showTab(7);
      act(() => {
        chromeMock.emit({
          type: "PAGE_NAVIGATED",
          tabId: 7,
        } as unknown as ContentToPanel);
      });
      await flush();

      await writtenElsewhere({ [SETTING]: true });
      act(() => {
        chromeMock.emit({ ...treeData(), tabId: 7 } as ContentToPanel);
      });
      await flush();

      expect(buttonNamed("NATIVE")).not.toBeNull();
      expect(sentOfType("NATIVE_READ")).toEqual([]);
    });

    it("lets a panel that never connected read its first page natively", async () => {
      // As a panel opened with native mode on would.
      mount({ storage: { [SETTING]: false, [NOTICE_SEEN]: true } });
      await flush();

      await writtenElsewhere({ [SETTING]: true });
      await showTab(7);

      expect(sentOfType("NATIVE_READ").length).toBeGreaterThan(0);
    });

    it("reads a removed or non-boolean setting as on", async () => {
      mount({ storage: { [SETTING]: false, [NOTICE_SEEN]: true } });
      await flush();
      await showTab(7);
      expect(buttonNamed("NATIVE")).toBeNull();

      await writtenElsewhere({ [SETTING]: undefined });
      expect(buttonNamed("NATIVE")).not.toBeNull();

      await writtenElsewhere({ [SETTING]: false });
      await writtenElsewhere({ [SETTING]: "false" });
      expect(buttonNamed("NATIVE")).not.toBeNull();
    });

    it("drops its own first read when a newer change has landed", async () => {
      let answer = () => {};
      mount({
        storage: { [NOTICE_SEEN]: true },
        // The mount-time read is slow, and answers from before the change.
        get: () =>
          new Promise((resolve) => {
            answer = () => resolve({ enabled: true });
          }),
      });
      await flush();
      await showTab(7);

      await writtenElsewhere({ [SETTING]: false });
      answer();
      await flush();

      expect(buttonNamed("NATIVE")).toBeNull();
      expect((await openSettings()).checked).toBe(false);
    });

    it("moves focus to the list shown in the tree's place", async () => {
      mount({ storage: { [NOTICE_SEEN]: true }, read: NATIVE_TREE });
      await flush();
      await showTab(7);
      // The DOM side is left on its Tab view, then the native tree shown.
      act(() => buttonNamed("DOM")!.click());
      await flush();
      act(() => buttonNamed("TAB")!.click());
      await flush();
      act(() => buttonNamed("NATIVE")!.click());
      await flush();
      const nativeTree = container.querySelector<HTMLElement>('[role="tree"]');
      act(() => nativeTree!.focus());

      await writtenElsewhere({ [SETTING]: false });

      expect(container.querySelector('[role="tree"]')).toBeNull();
      expect(document.activeElement?.getAttribute("role")).toBe("listbox");
    });

    it("puts focus back when the first read falls back to the DOM tree", async () => {
      let fail = () => {};
      mount({
        storage: { [NOTICE_SEEN]: true },
        read: () =>
          new Promise((resolve) => {
            fail = () => resolve(NATIVE_REFUSED);
          }),
      });
      await flush();
      await showTab(7);
      const nativeSearch = () =>
        container.querySelector<HTMLInputElement>(
          'input[aria-label="Search native tree nodes"]',
        );
      act(() => nativeSearch()!.focus());

      fail();
      await flush();

      expect(nativeSearch()).toBeNull();
      expect(document.activeElement?.getAttribute("role")).toBe("tree");
    });

    it("leaves an armed DOM pick alone when native mode is turned off", async () => {
      mount({ storage: { [NOTICE_SEEN]: true } });
      await flush();
      // The native default can't read this page, so the panel is on DOM.
      await showTab(7);
      const pick = () =>
        container.querySelector<HTMLButtonElement>(
          'button[aria-label="Pick element in page"]',
        );
      act(() => pick()!.click());
      await flush();
      expect(pick()!.getAttribute("aria-pressed")).toBe("true");

      await writtenElsewhere({ [SETTING]: false });

      // The content script's picker is still armed on the page, so the
      // button says so; nothing told the page to stop.
      expect(pick()!.getAttribute("aria-pressed")).toBe("true");
    });
  });

  describe("this panel's own change", () => {
    it("doesn't lose another window's answer that lands while it is on its way", async () => {
      mount({
        storage: { [NOTICE_SEEN]: true },
        set: (enabled) => {
          // This panel's turn-off is stored and echoed; before its reply
          // gets here, another window turns native mode back on.
          chromeMock.writeStorage({ [SETTING]: enabled });
          chromeMock.writeStorage({ [SETTING]: true });
          return { enabled, detached: 0 };
        },
      });
      await flush();
      await showTab(7);

      const checkbox = await openSettings();
      act(() => checkbox.click());
      await flush();

      // The setting is on, and this panel agrees, and says so last.
      expect(chromeMock.stored[SETTING]).toBe(true);
      expect(buttonNamed("NATIVE")).not.toBeNull();
      expect(announced()).toBe(
        "Reading pages through Chrome is on — NATIVE in the toolbar shows its tree.",
      );
      // Applied from what storage reported, in order: no second read whose
      // late reply could overwrite a newer change.
      expect(sentOfType("NATIVE_FLAG_GET")).toHaveLength(1);
    });

    it("ends off, on the DOM tree, when another window turns it off while its own turn-on is on its way", async () => {
      mount({
        storage: { [SETTING]: false, [NOTICE_SEEN]: true },
        set: (enabled) => {
          chromeMock.writeStorage({ [SETTING]: enabled });
          chromeMock.writeStorage({ [SETTING]: false });
          return { enabled, detached: 0 };
        },
      });
      await flush();
      await showTab(7);

      const checkbox = await openSettings();
      act(() => checkbox.click());
      await flush();

      expect(chromeMock.stored[SETTING]).toBe(false);
      expect(buttonNamed("NATIVE")).toBeNull();
      // The DOM tree's own controls are back, so the view really is DOM.
      expect(searchBox()).not.toBeNull();
      expect(announced()).toBe(
        "Not reading pages through Chrome — showing the DOM tree.",
      );
    });

    it("isn't left waiting by a send that throws, and still follows other windows", async () => {
      mount({
        storage: { [NOTICE_SEEN]: true },
        set: () => {
          // A torn-down context throws rather than rejecting.
          throw new Error("Extension context invalidated.");
        },
      });
      await flush();
      await showTab(7);

      const checkbox = await openSettings();
      act(() => checkbox.click());
      await flush();

      expect(announced()).toBe("Couldn't change that setting — try again.");
      expect(settingsCheckbox()!.getAttribute("aria-disabled")).toBe("false");
      // Its write is over, so another window's change still reaches it.
      await writtenElsewhere({ [SETTING]: false });
      expect(buttonNamed("NATIVE")).toBeNull();
    });

    it("leaves focus where the user moved it while its own turn-off was on its way", async () => {
      let release = () => {};
      mount({
        storage: { [NOTICE_SEEN]: true },
        set: (enabled) => {
          chromeMock.writeStorage({ [SETTING]: enabled });
          // The reply waits, as it does behind a native read in flight.
          return new Promise((resolve) => {
            release = () => resolve({ enabled, detached: 0 });
          });
        },
      });
      await flush();
      await showTab(7);

      const checkbox = await openSettings();
      act(() => checkbox.click());
      await flush();
      act(() => searchBox()!.focus());

      release();
      await flush();

      expect(buttonNamed("NATIVE")).toBeNull();
      expect(document.activeElement).toBe(searchBox());
    });
  });
});
