import type { DomSemanticNode } from "@real-a11y-dev/core";
import { render, h } from "preact";
import { act } from "preact/test-utils";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

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
 * "Show full names", in Settings: off by default, a long name in either tree
 * ends in an ellipsis and the tree fits the panel; on, the tree widens to
 * fit it (`.sn-tree--full-names`, tree.css). Kept in `chrome.storage.local`
 * and followed by every open panel, as the other settings are. jsdom has no
 * layout, so what is checked here is the switch, the storage and the class,
 * and the markup the layout relies on: a tooltip on each part that can end
 * in an ellipsis, and a row's key states inside its head, with its name.
 */

const NATIVE_MODE = "settings.nativeModeEnabled";

const LONG_NAME =
  "Página principal de la enciclopedia libre y políglota de la Fundación Wikimedia";
const LONG_VALUE =
  "https://es.wikipedia.org/wiki/Wikipedia:Portada?uselang=es&variant=es-mx";

/** A native read with a long-named link, a stated button, and two fields. */
const NATIVE_TREE = {
  ok: true,
  nodes: [
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
  ],
  rootId: "r1",
  url: "https://example.test/",
  documentId: "doc-1",
};

/** An in-page read with a stated, long-named button and a long-valued field. */
function fieldTreeData(): ContentToPanel {
  const nodes = [
    node("n1", null, 0, "document", "Page", ["b1", "t1"]),
    node("b1", "n1", 1, "button", LONG_NAME, [], "button"),
    node("t1", "n1", 1, "textbox", "Address", [], "input"),
  ];
  const button = nodes[1]![1] as DomSemanticNode;
  button.a11y.states = { disabled: true, expanded: false };
  const field = nodes[2]![1] as DomSemanticNode;
  field.a11y.value = LONG_VALUE;
  field.dom.attributes = { value: LONG_VALUE };
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

  it("gives a field's value, and a placeholder, its whole text as a tooltip", async () => {
    const value = (row: Element | null) => {
      const el = row?.querySelector(".sn-field-value");
      return [el?.textContent, el?.getAttribute("title")];
    };
    const announced = `= ${JSON.stringify(LONG_VALUE)}`;
    const raw = `value=${JSON.stringify(LONG_VALUE)}`;

    mount({ [NATIVE_MODE]: false });
    await flush();
    await showPage(fieldTreeData());
    expect(value(container.querySelector("#snrow-t1"))).toEqual([
      announced,
      announced,
    ]);
    const domView = [
      ...container.querySelectorAll('[aria-label="Tree view mode"] button'),
    ].find((b) => b.textContent?.trim() === "DOM") as HTMLButtonElement;
    act(() => domView.click());
    await flush();
    expect(value(container.querySelector("#snrow-t1"))).toEqual([raw, raw]);

    render(null, container);
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

  it("shows a row's key states after its label, where nothing clips them, in either tree", async () => {
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

    mount({ [NATIVE_MODE]: false });
    await flush();
    await showPage(fieldTreeData());
    expect(badges(container.querySelector("#snrow-b1"))).toEqual({
      key: ["disabled", "collapsed"],
      rest: [],
      heard: "disabled, collapsed",
    });

    render(null, container);
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
