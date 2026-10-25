import { render, h } from "preact";
import { act } from "preact/test-utils";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

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
 * "Show full names", in Settings: off by default, a long name in either tree
 * ends in an ellipsis and the tree fits the panel; on, the tree widens to
 * fit it (`.sn-tree--full-names`, tree.css). Kept in `chrome.storage.local`
 * and followed by every open panel, as the other settings are. jsdom has no
 * layout, so what is checked here is the switch, the storage and the class.
 */

const NATIVE_MODE = "settings.nativeModeEnabled";

const LONG_NAME =
  "Página principal de la enciclopedia libre y políglota de la Fundación Wikimedia";

/** A native read with a long-named link in it. */
const NATIVE_TREE = {
  ok: true,
  nodes: [
    {
      id: "r1",
      role: "RootWebArea",
      name: "Test page",
      depth: 0,
      childIds: ["a1"],
      states: {},
      properties: {},
    },
    {
      id: "a1",
      role: "link",
      name: LONG_NAME,
      depth: 1,
      childIds: [],
      states: {},
      properties: {},
    },
  ],
  rootId: "r1",
  url: "https://example.test/",
  documentId: "doc-1",
};

describe("Show full names", () => {
  let container: HTMLDivElement;
  let chromeMock: ChromeMock;

  /** Mount the panel over `storage`, reading natively unless the storage
   *  turns native mode off. */
  function mount(storage: Record<string, unknown> = {}): void {
    chromeMock = installChromeMock({
      storage,
      respond: (message) => {
        const m = message as unknown as { type: string };
        if (m.type === "NATIVE_FLAG_GET") {
          return { enabled: chromeMock.stored[NATIVE_MODE] !== false };
        }
        if (m.type === "NATIVE_READ") return NATIVE_TREE;
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

  /** The panel's bound tab becomes 7, and its page connects. */
  async function showPage(): Promise<void> {
    act(() => {
      chromeMock.emit({
        type: "ACTIVE_TAB_CHANGED",
        tabId: 7,
      } as unknown as ContentToPanel);
    });
    act(() => {
      chromeMock.emit({ ...treeData(), tabId: 7 } as ContentToPanel);
    });
    await flush();
  }

  const tree = () => container.querySelector<HTMLElement>('[role="tree"]');
  const fullNames = () =>
    tree()?.classList.contains("sn-tree--full-names") ?? null;

  /** The switch, with Settings opened if it isn't already. */
  async function fullNamesSwitch(): Promise<HTMLInputElement> {
    const settings = [...container.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Settings ▾",
    )!;
    if (settings.getAttribute("aria-expanded") !== "true") {
      act(() => settings.click());
      await flush();
    }
    const label = [
      ...container.querySelectorAll('[aria-label="Settings"] label'),
    ].find((l) => l.textContent?.trim() === "Show full names")!;
    return label.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  }

  async function writtenElsewhere(items: Record<string, unknown>) {
    act(() => chromeMock.writeStorage(items));
    await flush();
  }

  it("starts off, and turning it on widens the tree and is kept", async () => {
    mount({ [NATIVE_MODE]: false });
    await flush();
    await showPage();

    expect(fullNames()).toBe(false);
    const box = await fullNamesSwitch();
    expect(box.checked).toBe(false);
    expect(
      container.querySelector(`#${box.getAttribute("aria-describedby")}`)
        ?.textContent,
    ).toMatch(/scrolls sideways/);

    act(() => box.click());
    await flush();

    expect(chromeMock.stored[SHOW_FULL_NAMES_KEY]).toBe(true);
    expect(fullNames()).toBe(true);

    act(() => box.click());
    await flush();

    expect(chromeMock.stored[SHOW_FULL_NAMES_KEY]).toBe(false);
    expect(fullNames()).toBe(false);
  });

  it("starts on where storage says so", async () => {
    mount({ [NATIVE_MODE]: false, [SHOW_FULL_NAMES_KEY]: true });
    await flush();
    await showPage();

    expect(fullNames()).toBe(true);
    expect((await fullNamesSwitch()).checked).toBe(true);
  });

  it("follows a change made in another window", async () => {
    mount({ [NATIVE_MODE]: false });
    await flush();
    await showPage();

    await writtenElsewhere({ [SHOW_FULL_NAMES_KEY]: true });
    expect(fullNames()).toBe(true);

    await writtenElsewhere({ [SHOW_FULL_NAMES_KEY]: false });
    expect(fullNames()).toBe(false);
  });

  it("applies to Chrome's tree as well", async () => {
    mount({ [SHOW_FULL_NAMES_KEY]: true });
    await flush();
    await showPage();

    expect(tree()?.getAttribute("aria-label")).toMatch(
      /^Native accessibility tree/,
    );
    expect(fullNames()).toBe(true);

    await writtenElsewhere({ [SHOW_FULL_NAMES_KEY]: false });
    expect(fullNames()).toBe(false);
  });

  it("gives a name its whole text as a tooltip, in either tree", async () => {
    mount({ [NATIVE_MODE]: false });
    await flush();
    await showPage();
    const names = () =>
      [...container.querySelectorAll(".sn-name")].map((el) => [
        el.textContent,
        el.getAttribute("title"),
      ]);
    expect(names()).toContainEqual(["Save", "Save"]);

    render(null, container);
    mount();
    await flush();
    await showPage();
    expect(names()).toContainEqual([LONG_NAME, LONG_NAME]);
  });
});
