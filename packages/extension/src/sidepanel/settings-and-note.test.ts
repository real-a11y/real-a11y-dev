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

import { explainUnavailable } from "../native/capability.js";
import type { ContentToPanel } from "../types.js";

import { App } from "./App.js";
import { SHOW_FULL_NAMES_KEY } from "./full-names.js";
import type { ChromeMock } from "./panel-harness.js";
import {
  installChromeMock,
  stubMatchMedia,
  treeData,
} from "./panel-harness.js";

/**
 * The panel reads the first page through Chrome with nothing asked first,
 * and explains Chrome's debugging bar in a note the first time Chrome's tree
 * shows. Where Chrome won't let the debugger attach, it says why, and the TAB
 * view, which the debugger plays no part in, is still there. Settings, in
 * the header, holds Show full names.
 *
 * Each window has its own side panel, so every open panel follows the note's
 * acknowledgment in storage: acknowledged in one window, it goes in all.
 */

const NOTICE_SEEN = "settings.nativeNoticeSeen";

/** A native read that succeeds, so Chrome's tree stays on screen. */
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

/** A native read Chrome refuses: DevTools holds the tab. */
const NATIVE_REFUSED = {
  ok: false,
  error: "unavailable",
  reason: "devtools-conflict",
};

describe("Settings and the note about Chrome's debugging bar", () => {
  let container: HTMLDivElement;
  let chromeMock: ChromeMock;

  function mount(
    options: {
      /** Extension storage, to keep whether the note was acknowledged, and
       *  the other settings in. */
      storage?: Record<string, unknown>;
      /** What a native read answers, or a function of the tab it reads. */
      read?: unknown;
    } = {},
  ): void {
    chromeMock = installChromeMock({
      storage: options.storage,
      respond: (message) => {
        const m = message as unknown as { type: string };
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
      .map((m) => m as unknown as { type: string })
      .filter((m) => m.type === type);

  const searchBox = () =>
    container.querySelector<HTMLInputElement>(
      'input[aria-label="Search native tree nodes"]',
    );

  it("reads the first page through Chrome, with nothing asked first", async () => {
    mount();
    await flush();
    await showTab(7);

    expect(sentOfType("NATIVE_READ").length).toBeGreaterThan(0);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("reads nothing before a page connects, and the first page that does", async () => {
    mount({ read: NATIVE_TREE });
    await flush();
    act(() => {
      chromeMock.emit({
        type: "ACTIVE_TAB_CHANGED",
        tabId: 7,
      } as unknown as ContentToPanel);
    });
    await flush();
    // Nothing proves there is a page there yet, and each read shows
    // Chrome's debugging bar.
    expect(sentOfType("NATIVE_READ")).toEqual([]);

    act(() => {
      chromeMock.emit({ ...treeData(), tabId: 7 } as ContentToPanel);
    });
    await flush();
    expect(sentOfType("NATIVE_READ")).toHaveLength(1);
  });

  it("says why Chrome refused, and still offers the TAB view", async () => {
    mount({ storage: { [NOTICE_SEEN]: true }, read: NATIVE_REFUSED });
    await flush();
    await showTab(7);

    // Once: the banner over the tree says why, and the status line only that
    // Chrome's tree is unavailable.
    expect(
      container.textContent!.split(explainUnavailable("devtools-conflict")),
    ).toHaveLength(2);
    expect(
      container.querySelector('.sn-page-url[aria-live="polite"]')?.textContent,
    ).toBe("native unavailable");
    expect(
      [...container.querySelectorAll("button.sn-toggle-btn")].map((b) =>
        b.textContent?.trim(),
      ),
    ).toEqual(["A11Y", "TAB"]);
    // No in-page tree to fall back on, nor a control to choose one.
    expect(
      container.querySelector('[role="group"][aria-label="Tree view mode"]'),
    ).toBeNull();
    expect(container.querySelector("[data-node-id='n3']")).toBeNull();
  });

  describe("the note about Chrome's debugging bar", () => {
    it("shows with Chrome's tree, and is said once", async () => {
      mount({ storage: {}, read: NATIVE_TREE });
      await flush();
      await showTab(7);

      expect(note()).not.toBeNull();
      expect(note()?.textContent).toContain("started debugging this browser");
      expect(announced()).toContain("started debugging this browser");
      // Acknowledging it is all there is to do: Chrome's tree is the only
      // one.
      expect(buttonNamed("Turn off")).toBeNull();
    });

    it("goes for good with Got it, in every window", async () => {
      mount({ storage: {}, read: NATIVE_TREE });
      await flush();
      await showTab(7);

      // From the keyboard: focus is on the button that goes with the note.
      act(() => buttonNamed("Got it")!.focus());
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

    it("doesn't show while no read has succeeded", async () => {
      // The native read fails, so no bar shows: no note either.
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

      act(() => buttonNamed("Got it")!.focus());
      act(() => buttonNamed("Got it")!.click());
      await flush();

      expect(document.activeElement?.getAttribute("role")).toBe("listbox");
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
    it("holds Show full names, and no choice of tree", async () => {
      mount({ storage: { [NOTICE_SEEN]: true }, read: NATIVE_TREE });
      await flush();
      await showTab(7);
      await openSettings();

      const group = container.querySelector(
        '[role="group"][aria-label="Settings"]',
      )!;
      expect(
        [...group.querySelectorAll("label")].map((l) => l.textContent?.trim()),
      ).toEqual(["Show full names"]);
      expect(buttonNamed("Chrome's tree")).toBeNull();
      expect(buttonNamed("In-page tree")).toBeNull();
    });

    it("sits in the header, not the toolbar, and opens as a disclosure", async () => {
      mount({ storage: { [NOTICE_SEEN]: true } });
      await flush();
      await showTab(7);
      const button = buttonNamed("Settings ▾")!;

      // The header is drawn whether or not a page is connected; the
      // toolbar only once one is.
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
      // Named as the Copy report names it.
      expect(container.querySelector(".sn-page-title")?.textContent).toContain(
        "https://example.test/",
      );
    });

    it("is there before a page connects", async () => {
      mount({ storage: { [NOTICE_SEEN]: true } });
      await flush();

      expect(buttonNamed("Settings ▾")).not.toBeNull();
      expect((await openSettings()).checked).toBe(false);
    });

    it("stays open on an Escape that cancels an armed native pick", async () => {
      mount({ storage: { [NOTICE_SEEN]: true }, read: NATIVE_TREE });
      await flush();
      await showTab(7);
      // A native pick, waiting for a click on the page.
      act(() =>
        container
          .querySelector<HTMLButtonElement>(
            'button[aria-label="Pick element in page"]',
          )!
          .click(),
      );
      await flush();
      const checkbox = await openSettings();

      act(() => {
        checkbox.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Escape",
            bubbles: true,
            cancelable: true,
          }),
        );
      });
      await flush();

      // The Escape was the pick's: it is cancelled, and Settings stays.
      expect(sentOfType("NATIVE_PICK_STOP")).toHaveLength(1);
      expect(settingsCheckbox()).not.toBeNull();
    });

    it("closes on a press outside it, with any button, leaving focus to the press", async () => {
      mount({ storage: { [NOTICE_SEEN]: true }, read: NATIVE_TREE });
      await flush();
      await showTab(7);
      const checkbox = await openSettings();
      act(() => checkbox.focus());

      // As Chrome times them: the popup re-renders in the microtask between
      // the two, while its listeners, removed after a paint, are still there
      // for the mousedown.
      searchBox()!.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, button: 2 }),
      );
      await Promise.resolve();
      searchBox()!.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 2 }),
      );
      await flush();

      expect(settingsCheckbox()).toBeNull();
      // The switch went with it, and focus goes where the press puts it, not
      // to the tree.
      expect(document.activeElement).toBe(document.body);
    });

    it("stays open when a press inside it ends outside", async () => {
      mount({ storage: { [NOTICE_SEEN]: true } });
      await flush();
      await showTab(7);
      const checkbox = await openSettings();

      act(() => {
        checkbox.dispatchEvent(
          new MouseEvent("pointerdown", { bubbles: true }),
        );
        checkbox.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      });
      // Released over the tree: the click goes to what holds both points.
      act(() => container.querySelector<HTMLElement>(".sn-root")!.click());
      await flush();

      expect(settingsCheckbox()).not.toBeNull();
      expect(settingsCheckbox()!.checked).toBe(false);
      expect(chromeMock.stored[SHOW_FULL_NAMES_KEY]).toBeUndefined();
    });

    it("stays open when the window gives focus back to the panel", async () => {
      mount({ storage: { [NOTICE_SEEN]: true } });
      await flush();
      await showTab(7);
      await openSettings();

      // Chrome sends focusin, and no focusout, to what had focus when the
      // window comes back to the front.
      act(() => {
        container
          .querySelector('[role="tree"]')!
          .dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      });
      await flush();

      expect(settingsCheckbox()).not.toBeNull();
    });

    it("closes on a press with no pointer events, as a screen reader's click makes, keeping focus", async () => {
      mount({ storage: { [NOTICE_SEEN]: true }, read: NATIVE_TREE });
      await flush();
      await showTab(7);
      const checkbox = await openSettings();
      act(() => checkbox.focus());

      // On a tree row, which can't take focus, so the click moves none.
      act(() => {
        container
          .querySelector('[role="treeitem"]')!
          .dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      });
      await flush();

      expect(settingsCheckbox()).toBeNull();
      // Not left on the body with the switch: where a real press would have
      // put it, on the tree around the row.
      expect(document.activeElement?.getAttribute("role")).toBe("tree");

      // With nothing around what was clicked to take focus, back on
      // Settings, as Escape leaves it.
      const again = await openSettings();
      act(() => again.focus());
      act(() => {
        container
          .querySelector(".sn-root")!
          .dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      });
      await flush();
      expect(settingsCheckbox()).toBeNull();
      expect(document.activeElement).toBe(buttonNamed("Settings ▾"));
    });

    it("is never open together with the Copy menu, however that is opened", async () => {
      mount({ storage: { [NOTICE_SEEN]: true } });
      await flush();
      await showTab(7);
      await openSettings();

      // From the keyboard: Enter on Copy, with no press anywhere.
      act(() => buttonNamed("Copy ▾")!.click());
      await flush();
      expect(buttonNamed("Everything")).not.toBeNull();
      expect(settingsCheckbox()).toBeNull();

      act(() => buttonNamed("Settings ▾")!.click());
      await flush();
      expect(settingsCheckbox()).not.toBeNull();
      expect(buttonNamed("Everything")).toBeNull();
    });

    it("doesn't come back with the Copy menu still open after the page reconnects", async () => {
      mount({ storage: { [NOTICE_SEEN]: true } });
      await flush();
      await showTab(7);
      act(() => buttonNamed("Copy ▾")!.click());
      await flush();
      expect(buttonNamed("Everything")).not.toBeNull();

      act(() => {
        chromeMock.emit({
          type: "PAGE_NAVIGATED",
          tabId: 7,
        } as unknown as ContentToPanel);
      });
      await flush();
      act(() => {
        chromeMock.emit({ ...treeData(), tabId: 7 } as ContentToPanel);
      });
      await flush();

      expect(buttonNamed("Everything")).toBeNull();
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

  describe("focus", () => {
    it("stays where it was when the first read fails", async () => {
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
      act(() => searchBox()!.focus());

      fail();
      await flush();

      // Chrome's tree says why, and its controls stay.
      expect(document.activeElement).toBe(searchBox());
    });

    it("leaves a panel nobody has focused alone when the first read fails", async () => {
      mount({ storage: { [NOTICE_SEEN]: true }, read: NATIVE_REFUSED });
      await flush();

      await showTab(7);

      expect(document.activeElement).toBe(document.body);
    });

    it("leaves focus as a navigation leaves it, not on Settings", async () => {
      mount({ storage: { [NOTICE_SEEN]: true } });
      await flush();
      await showTab(7);
      const tree = () => container.querySelector<HTMLElement>('[role="tree"]');
      act(() => tree()!.focus());

      act(() => {
        chromeMock.emit({
          type: "PAGE_NAVIGATED",
          tabId: 7,
        } as unknown as ContentToPanel);
      });
      await flush();
      expect(tree()).toBeNull();
      expect(document.activeElement).toBe(document.body);

      // Nor does it wait for the tree, which may come much later, if at all.
      act(() => {
        chromeMock.emit({ ...treeData(), tabId: 7 } as ContentToPanel);
      });
      await flush();
      expect(document.activeElement).toBe(document.body);
    });

    it("returns focus to Copy when its menu closes", async () => {
      mount({ storage: { [NOTICE_SEEN]: true }, read: NATIVE_TREE });
      await flush();
      await showTab(7);
      act(() => buttonNamed("Copy ▾")!.click());
      await flush();
      act(() => buttonNamed("Everything")!.focus());

      act(() => {
        buttonNamed("Everything")!.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
      });
      await flush();

      expect(buttonNamed("Everything")).toBeNull();
      expect(document.activeElement).toBe(buttonNamed("Copy ▾"));

      // Choosing an item closes it the same way. jsdom has no clipboard.
      const clipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: () => Promise.resolve() },
      });
      onTestFinished(() => {
        if (clipboard) Object.defineProperty(navigator, "clipboard", clipboard);
        else delete (navigator as { clipboard?: unknown }).clipboard;
      });
      act(() => buttonNamed("Copy ▾")!.click());
      await flush();
      act(() => buttonNamed("Everything")!.focus());
      act(() => buttonNamed("Everything")!.click());
      await flush();

      expect(buttonNamed("Everything")).toBeNull();
      expect(document.activeElement).toBe(buttonNamed("Copy ▾"));
    });
  });
});
