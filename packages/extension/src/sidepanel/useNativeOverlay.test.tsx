import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  useNativeOverlay,
  type NativeOverlayInputs,
} from "./useNativeOverlay.js";

type Overlay = ReturnType<typeof useNativeOverlay>;

describe("useNativeOverlay", () => {
  let container: HTMLDivElement;
  let overlay: Overlay;
  let sent: Array<Record<string, unknown>>;
  // What the service worker answers each NATIVE_ACT with, settled by hand.
  let answers: Array<(answer: unknown) => void>;
  const announce = vi.fn();

  const inputs = (
    over: Partial<NativeOverlayInputs> = {},
  ): NativeOverlayInputs => ({
    enabled: true,
    tabId: 7,
    busy: false,
    curtainOn: false,
    pickArmed: false,
    userOpInFlight: () => false,
    announce,
    ...over,
  });

  function Harness(props: { inputs: NativeOverlayInputs }) {
    overlay = useNativeOverlay(props.inputs);
    return null;
  }
  const mount = (over: Partial<NativeOverlayInputs> = {}) =>
    act(() => render(<Harness inputs={inputs(over)} />, container));

  beforeEach(() => {
    container = document.createElement("div");
    sent = [];
    answers = [];
    announce.mockReset();
    (globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: {
        sendMessage: vi.fn((message: Record<string, unknown>) => {
          sent.push(message);
          if (message.type !== "NATIVE_ACT") return Promise.resolve();
          return new Promise((resolve) => answers.push(resolve));
        }),
      },
    };
  });
  afterEach(() => {
    render(null, container);
    delete (globalThis as { chrome?: unknown }).chrome;
  });

  const acts = () => sent.filter((m) => m.type === "NATIVE_ACT");
  const clears = () => sent.filter((m) => m.type === "CLEAR_HIGHLIGHT");
  /** Settle the oldest pending answer, and let its handlers run. */
  async function answer(value: unknown = { success: true }) {
    answers.shift()!(value);
    await act(async () => {});
  }

  it("asks for a preview and a reveal under one counter of request ids", () => {
    mount();
    overlay.preview("ax-dom-5");
    overlay.reveal("ax-dom-6");
    overlay.preview("ax-dom-7");
    expect(acts()).toEqual([
      expect.objectContaining({ action: "preview", requestId: 1, tabId: 7 }),
      expect.objectContaining({ action: "reveal", requestId: 2 }),
      expect.objectContaining({ action: "preview", requestId: 3 }),
    ]);
  });

  it.each([
    ["native mode is off", { enabled: false }],
    ["no tree has been read", { tabId: undefined }],
    ["the panel is busy", { busy: true }],
    ["Screen Curtain is on", { curtainOn: true }],
    ["a pick is armed", { pickArmed: true }],
    ["the user's read or action is in flight", { userOpInFlight: () => true }],
  ] as const)("previews nothing while %s", (_why, over) => {
    mount(over);
    overlay.preview("ax-dom-5");
    expect(acts()).toEqual([]);
  });

  it("previews nothing for a row with no backing element", () => {
    mount();
    overlay.preview("ax-12");
    expect(acts()).toEqual([]);
  });

  it("reveals while a pick is armed, since the user chose the row", () => {
    mount({ pickArmed: true });
    overlay.reveal("ax-dom-5");
    expect(acts()).toHaveLength(1);
  });

  it("clears on leaving, even the selection's outline, as the DOM tree's hover does", async () => {
    mount();
    overlay.preview("ax-dom-5");
    await answer();
    overlay.reveal("ax-dom-5"); // the row is clicked
    overlay.preview(null);
    expect(clears()).toEqual([{ type: "CLEAR_HIGHLIGHT", tabId: 7 }]);
  });

  it("clears a clicked row's reveal that settles after the pointer left", async () => {
    mount();
    overlay.preview("ax-dom-5");
    await answer();
    overlay.reveal("ax-dom-5"); // the row is clicked
    overlay.preview(null);
    expect(clears()).toHaveLength(1);
    await answer(); // the reveal draws after that clear
    expect(clears()).toEqual([
      { type: "CLEAR_HIGHLIGHT", tabId: 7 },
      { type: "CLEAR_HIGHLIGHT", tabId: 7 },
    ]);
  });

  it("clears on the tab the preview was drawn on, not the panel's new one", async () => {
    mount();
    overlay.preview("ax-dom-5");
    await answer();
    mount({ tabId: 8 });
    overlay.preview(null);
    expect(clears()).toEqual([{ type: "CLEAR_HIGHLIGHT", tabId: 7 }]);
  });

  it("clears what a late preview drew once the pointer has left", async () => {
    mount();
    overlay.preview("ax-dom-5");
    overlay.preview(null);
    expect(clears()).toHaveLength(1);
    await answer();
    expect(clears()).toHaveLength(2);
  });

  it("leaves a newer overlay alone when a late preview settles", async () => {
    mount();
    overlay.preview("ax-dom-5");
    overlay.preview(null);
    overlay.reveal("ax-dom-9"); // a keyboard selection after the pointer left
    await answer();
    expect(clears()).toHaveLength(1);
    await answer(); // the reveal stays: asked for after the pointer left
    expect(clears()).toHaveLength(1);
  });

  it.each([
    ["refused for a reason", { success: false, reason: "devtools-open" }],
    [
      "refused by the user's Cancel",
      { success: false, error: "cancelled-by-user" },
    ],
  ])(
    "stops previews on the tab when %s, until a read succeeds there",
    async (_why, refusal) => {
      mount();
      overlay.preview("ax-dom-5");
      await answer(refusal);
      overlay.preview("ax-dom-6");
      expect(acts()).toHaveLength(1);
      // Reveals still follow the selection: the user asked for those.
      overlay.reveal("ax-dom-6");
      expect(acts()).toHaveLength(2);
      overlay.resumePreviews(7);
      overlay.preview("ax-dom-6");
      expect(acts()).toHaveLength(3);
    },
  );

  it("doesn't pause the new tab on a refusal from the tab it left", async () => {
    mount();
    overlay.preview("ax-dom-5");
    mount({ tabId: 8 });
    await answer({ success: false, reason: "devtools-open" });
    overlay.preview("ax-dom-6");
    expect(acts()).toHaveLength(2);
    expect(acts()[1]).toMatchObject({ tabId: 8 });
  });

  it("says once per tab that a page can't show the outline", async () => {
    mount();
    overlay.reveal("ax-dom-5");
    await answer({ success: true, outlined: false });
    overlay.reveal("ax-dom-6");
    await answer({ success: true, outlined: false });
    expect(announce).toHaveBeenCalledTimes(1);
  });
});
