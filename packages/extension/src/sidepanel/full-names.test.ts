import { render, h } from "preact";
import { act } from "preact/test-utils";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import type { NativeNode } from "../native/native-actions.js";
import type { ContentToPanel } from "../types.js";

import { App } from "./App.js";
import { SHOW_FULL_NAMES_KEY } from "./full-names.js";
import type { ChromeMock } from "./panel-harness.js";
import {
  installChromeMock,
  node,
  stubMatchMedia,
  treeData,
} from "./panel-harness.js";

/**
 * "Show full names", in Settings: off by default, a long name in Chrome's
 * tree ends in an ellipsis and the tree fits the panel; on, the tree widens
 * to fit it (`.sn-tree--full-names`, tree.css), and so does the TAB view's
 * list (`.sn-filtered-list--full-names`, lists.css). Kept in
 * `chrome.storage.local` and followed by every open panel, as the other
 * settings are. jsdom has no layout, so what is checked here is the switch,
 * the storage and the class, and the markup the layout relies on: a tooltip
 * on each part that can end in an ellipsis, and a row's key states inside
 * its head, with its name.
 */

const LONG_NAME =
  "Página principal de la enciclopedia libre y políglota de la Fundación Wikimedia";
const LONG_VALUE =
  "https://es.wikipedia.org/wiki/Wikipedia:Portada?uselang=es&variant=es-mx";

/** A native read with a long-named link, a stated button, and two fields. */
const NATIVE_TREE: NativeNode[] = [
  {
    id: "r1",
    role: "RootWebArea",
    name: "Test page",
    depth: 0,
    childIds: ["a1", "b1", "t1", "s1"],
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
  {
    id: "b1",
    role: "button",
    name: LONG_NAME,
    depth: 1,
    childIds: [],
    states: { focusable: true, disabled: true, expanded: false },
    properties: { hasPopup: "menu" },
  },
  {
    id: "t1",
    role: "textbox",
    name: "Address",
    depth: 1,
    childIds: [],
    states: {},
    properties: {},
    value: LONG_VALUE,
  },
  {
    id: "s1",
    role: "searchbox",
    name: "Find",
    depth: 1,
    childIds: [],
    states: {},
    properties: {},
    placeholder: LONG_VALUE,
  },
];

/** The page's tree for the TAB view: one long-named button, a tab stop. */
function tabOrderData(): ContentToPanel {
  const nodes = [
    node("n1", null, 0, "document", "Page", ["b1"]),
    node("b1", "n1", 1, "button", LONG_NAME, [], "button"),
  ];
  (nodes[1]![1].interaction as { isFocusable: boolean }).isFocusable = true;
  return {
    ...treeData(),
    payload: {
      nodes,
      rootId: "n1",
      pageTitle: "Test page",
      pageUrl: "https://example.test/",
    },
  } as unknown as ContentToPanel;
}

describe("Show full names", () => {
  let container: HTMLDivElement;
  let chromeMock: ChromeMock;

  /** Mount the panel over `storage`, on Chrome's tree. */
  function mount(storage: Record<string, unknown> = {}): void {
    chromeMock = installChromeMock({ storage, nativeTree: NATIVE_TREE });
    act(() => {
      render(h(App, {}), container);
    });
  }

  const scrollIntoView = Element.prototype.scrollIntoView;

  beforeEach(() => {
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
    Element.prototype.scrollIntoView = scrollIntoView;
  });

  /** Let the promise-form replies land and the effects they trigger run. */
  async function flush(): Promise<void> {
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        await Promise.resolve();
      });
    }
  }

  /** The panel's bound tab becomes 7, and its page connects with `data`. */
  async function showPage(data = treeData()): Promise<void> {
    act(() => {
      chromeMock.emit({
        type: "ACTIVE_TAB_CHANGED",
        tabId: 7,
      } as unknown as ContentToPanel);
    });
    act(() => {
      chromeMock.emit({ ...data, tabId: 7 } as ContentToPanel);
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
    mount();
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
    mount({ [SHOW_FULL_NAMES_KEY]: true });
    await flush();
    await showPage();

    expect(fullNames()).toBe(true);
    expect((await fullNamesSwitch()).checked).toBe(true);
  });

  it("follows a change made in another window", async () => {
    mount();
    await flush();
    await showPage();

    await writtenElsewhere({ [SHOW_FULL_NAMES_KEY]: true });
    expect(fullNames()).toBe(true);

    await writtenElsewhere({ [SHOW_FULL_NAMES_KEY]: false });
    expect(fullNames()).toBe(false);
  });

  it("applies to the TAB view's list as well", async () => {
    mount({ [SHOW_FULL_NAMES_KEY]: true });
    await flush();
    await showPage();
    const tab = [...container.querySelectorAll("button.sn-toggle-btn")].find(
      (b) => b.textContent?.trim() === "TAB",
    ) as HTMLButtonElement;
    act(() => tab.click());
    act(() =>
      chromeMock.emit({ ...tabOrderData(), tabId: 7 } as ContentToPanel),
    );
    await flush();
    const list = () =>
      container.querySelector<HTMLElement>(
        '[role="listbox"][aria-label="Tab sequence"]',
      );
    const stop = list()?.querySelector(".sn-filtered-name");
    expect([stop?.textContent, stop?.getAttribute("title")]).toEqual([
      LONG_NAME,
      LONG_NAME,
    ]);
    expect(list()?.classList.contains("sn-filtered-list--full-names")).toBe(
      true,
    );

    await writtenElsewhere({ [SHOW_FULL_NAMES_KEY]: false });
    expect(list()?.classList.contains("sn-filtered-list--full-names")).toBe(
      false,
    );
  });

  it("gives a name its whole text as a tooltip", async () => {
    mount();
    await flush();
    await showPage();
    const names = () =>
      [...container.querySelectorAll(".sn-name")].map((el) => [
        el.textContent,
        el.getAttribute("title"),
      ]);
    expect(names()).toContainEqual([LONG_NAME, LONG_NAME]);
  });

  it("gives a field's value, and a placeholder, its whole text as a tooltip", async () => {
    const value = (row: Element | null) => {
      const el = row?.querySelector(".sn-field-value");
      return [el?.textContent, el?.getAttribute("title")];
    };
    const announced = `= ${JSON.stringify(LONG_VALUE)}`;

    mount();
    await flush();
    await showPage();
    expect(value(container.querySelector('[data-node-id="t1"]'))).toEqual([
      announced,
      announced,
    ]);
    expect(value(container.querySelector('[data-node-id="s1"]'))).toEqual([
      `placeholder: ${JSON.stringify(LONG_VALUE)}`,
      `Placeholder hint: ${JSON.stringify(LONG_VALUE)}`,
    ]);
  });

  it("shows a row's key states after its label, where nothing clips them", async () => {
    /** Row `row`'s state badges: its key states, after its label, which a
     *  row too narrow for them widens to show (tree.css, "Long labels"), and
     *  the rest, in the label, which a narrow row drops first. Also what a
     *  screen reader hears of its key states, after the name, since the
     *  badges are hidden from it. */
    const badges = (row: Element | null) => ({
      key: [
        ...(row?.querySelectorAll(
          '.sn-label + .sn-key-states[aria-hidden="true"] > *',
        ) ?? []),
      ].map((b) => b.textContent),
      rest: [
        ...(row?.querySelectorAll(".sn-label > .sn-state-badges > *") ?? []),
      ].map((b) => b.textContent),
      heard: row?.querySelector(".sn-name ~ .sn-sr-only")?.textContent,
    });

    mount();
    await flush();
    await showPage();
    expect(badges(container.querySelector('[data-node-id="b1"]'))).toEqual({
      key: ["disabled", "collapsed"],
      rest: ["focusable", "hasPopup=menu"],
      heard: "disabled, collapsed",
    });
  });
});
