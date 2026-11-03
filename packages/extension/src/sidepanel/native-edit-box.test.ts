import { render, h } from "preact";
import { act } from "preact/test-utils";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import type { NativeNode } from "../native/native-actions.js";
import type { ContentToPanel } from "../types.js";

import { App } from "./App.js";
import type { ChromeMock } from "./panel-harness.js";
import {
  TAB_ID,
  installChromeMock,
  stubMatchMedia,
  treeData,
} from "./panel-harness.js";

/**
 * The edit box a typable row of Chrome's tree opens (`handleNativeActivate`).
 * A box that opens empty in place of a value it can't show or start from
 * must cancel an untouched Enter: dispatched, it types `""` over what the
 * field holds. That covers every field whose value is withheld, not only one
 * that reads `[redacted]`. An editor around a card field reads no value at
 * all, and typing `""` into it cleared its text and the card field with it.
 * Nor does it take a withheld value: a row nothing withholds that shows no
 * value isn't necessarily empty. Chromium gives an editor holding only an
 * image no value at all, and typing `""` into it deleted the image.
 */

const PAGE_URL = "https://example.test/";

const field = (
  id: string,
  name: string,
  facets: Partial<NativeNode>,
): NativeNode => ({ id, role: "textbox", name, depth: 1, ...facets });

const NODES: NativeNode[] = [
  {
    id: "ax-root",
    role: "document",
    name: "",
    depth: 0,
    childIds: [
      "ax-dom-2",
      "ax-dom-3",
      "ax-dom-4",
      "ax-dom-5",
      "ax-dom-6",
      "ax-dom-7",
      "ax-dom-8",
      "ax-dom-9",
    ],
  },
  // A sensitive field that holds something.
  field("ax-dom-2", "Password", {
    value: "[redacted]",
    redacted: true,
    valueWithheld: true,
  }),
  // Withheld with nothing to show: an editor around a card field, a field
  // inside a sensitive one, and one the in-page read couldn't classify all
  // arrive like this, and each can still hold text.
  field("ax-dom-3", "Payment note", { valueWithheld: true }),
  // A row the in-page read never answered for carries no verdict at all.
  field("ax-dom-4", "Reference", {}),
  // An ordinary field, with its raw value for a retype to start from.
  field("ax-dom-5", "Full name", {
    value: "Jane Doe",
    rawValue: "Jane Doe",
    valueWithheld: false,
  }),
  // An editor nothing withholds: its text shows, but a retype replaces it
  // whole, so there is nothing to start from.
  field("ax-dom-6", "Message", { value: "Hello world", valueWithheld: false }),
  // A textarea: its announced value collapses its lines, its raw value keeps
  // them, and Chromium says it takes lines.
  field("ax-dom-7", "Letter", {
    value: "Dear Sam, Thanks!",
    rawValue: "Dear Sam,\nThanks!",
    valueWithheld: false,
    states: { multiline: true },
  }),
  // Two rows nothing withholds that show no value, which the wire can't tell
  // apart: an editor holding only an image (Chromium gives it no value at
  // all, and says it takes lines) and an empty field.
  field("ax-dom-8", "Signature pad", {
    valueWithheld: false,
    states: { editable: "richtext", multiline: true },
  }),
  field("ax-dom-9", "Nickname", {
    valueWithheld: false,
    states: { editable: "plaintext" },
  }),
];

describe("Chrome's tree: the edit box a typable row opens", () => {
  let container: HTMLDivElement;
  let chromeMock: ChromeMock;

  beforeEach(() => {
    vi.useFakeTimers();
    stubMatchMedia();
    chromeMock = installChromeMock({
      respond: (message) => {
        const type = (message as { type: string }).type;
        if (type === "NATIVE_READ") {
          return {
            ok: true,
            url: PAGE_URL,
            rootId: "ax-root",
            nodes: structuredClone(NODES),
          };
        }
        return undefined;
      },
    });
    // An action first checks the tab is still on the page the tree came from.
    Object.assign((globalThis as unknown as { chrome: object }).chrome, {
      tabs: { get: async () => ({ id: TAB_ID, url: PAGE_URL }) },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    container.remove();
    vi.useRealTimers();
  });

  async function flush(): Promise<void> {
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        await Promise.resolve();
      });
    }
  }

  async function showNative(): Promise<void> {
    act(() => {
      render(h(App, {}), container);
    });
    await flush();
    act(() => {
      chromeMock.emit({
        type: "ACTIVE_TAB_CHANGED",
        tabId: TAB_ID,
      } as unknown as ContentToPanel);
    });
    act(() => {
      chromeMock.emit(treeData());
    });
    await flush();
    expect(container.querySelector('[data-node-id="ax-dom-6"]')).not.toBeNull();
  }

  /** The open edit box, whichever element it is: a one-line input, or a
   *  textarea for a field that takes lines. */
  const box = () =>
    container.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      ".sn-input-panel-field",
    );

  /** Open a row's edit box from its Type button. */
  async function open(
    id: string,
  ): Promise<HTMLInputElement | HTMLTextAreaElement> {
    const type = container.querySelector<HTMLButtonElement>(
      `[data-node-id="${id}"] button[title="Type (Enter)"]`,
    );
    expect(type, id).not.toBeNull();
    act(() => type!.click());
    await flush();
    expect(box(), id).not.toBeNull();
    return box()!;
  }

  function typeInto(
    input: HTMLInputElement | HTMLTextAreaElement,
    text: string,
  ): void {
    act(() => {
      input.value = text;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  async function enter(
    input: HTMLInputElement | HTMLTextAreaElement,
  ): Promise<void> {
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    await flush();
  }

  const typed = () =>
    chromeMock.sent
      .filter((m) => (m as { type: string }).type === "NATIVE_ACT")
      .map((m) => {
        const { nodeId, action, value } = m as {
          nodeId?: string;
          action?: string;
          value?: string;
        };
        return { nodeId, action, value };
      });

  it.each([
    ["a field that reads [redacted]", "ax-dom-2"],
    ["a withheld field with no value to show", "ax-dom-3"],
    ["a row the in-page read never answered for", "ax-dom-4"],
  ])(
    "%s: opens empty and masked, and an untouched Enter types nothing",
    async (_, id) => {
      await showNative();
      const input = await open(id);
      expect(input.value).toBe("");
      expect(input.type).toBe("password");
      await enter(input);
      expect(box()).toBeNull();
      expect(typed()).toEqual([]);
    },
  );

  it("still empties a withheld field the user typed into and then cleared", async () => {
    await showNative();
    const input = await open("ax-dom-3");
    typeInto(input, "x");
    typeInto(input, "");
    await enter(input);
    expect(typed()).toEqual([
      { nodeId: "ax-dom-3", action: "type", value: "" },
    ]);
  });

  it("starts an ordinary field's box on its raw value, and an untouched Enter types it back", async () => {
    await showNative();
    const input = await open("ax-dom-5");
    expect(input.value).toBe("Jane Doe");
    expect(input.type).toBe("text");
    await enter(input);
    expect(typed()).toEqual([
      { nodeId: "ax-dom-5", action: "type", value: "Jane Doe" },
    ]);
  });

  // A one-line box strips line breaks, so an edit typed the letter back as
  // one line.
  it("opens a textarea's box multi-line on its raw value, and an edit keeps its lines", async () => {
    await showNative();
    const area = await open("ax-dom-7");
    expect(area.localName).toBe("textarea");
    expect(area.value).toBe("Dear Sam,\nThanks!");
    typeInto(area, `${area.value}\nJo`);
    await enter(area);
    expect(typed()).toEqual([
      { nodeId: "ax-dom-7", action: "type", value: "Dear Sam,\nThanks!\nJo" },
    ]);
  });

  it("opens an editor nothing withholds empty and unmasked, and an untouched Enter types nothing", async () => {
    await showNative();
    const input = await open("ax-dom-6");
    expect(input.value).toBe("");
    expect(input.type).toBe("text");
    await enter(input);
    expect(box()).toBeNull();
    expect(typed()).toEqual([]);
  });

  it.each([
    ["an editor holding only an image", "ax-dom-8"],
    ["an empty field", "ax-dom-9"],
  ])(
    "%s shows no value: opens empty and unmasked, and an untouched Enter types nothing",
    async (_, id) => {
      await showNative();
      const input = await open(id);
      expect(input.value).toBe("");
      // Unmasked, in whichever box the field gets: an input's type is
      // `text`, a textarea's `textarea`.
      expect(input.type).not.toBe("password");
      await enter(input);
      expect(box()).toBeNull();
      expect(typed()).toEqual([]);
    },
  );

  it("still empties a field that shows no value once the user typed into it and cleared it", async () => {
    await showNative();
    const input = await open("ax-dom-8");
    typeInto(input, "x");
    typeInto(input, "");
    await enter(input);
    expect(typed()).toEqual([
      { nodeId: "ax-dom-8", action: "type", value: "" },
    ]);
  });
});
