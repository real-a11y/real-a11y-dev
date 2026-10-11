// @vitest-environment node
/// <reference types="chrome" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const EXTENSION_ID = "abcdefghijklmnopabcdefghijklmnop";
const ORIGIN = `chrome-extension://${EXTENSION_ID}/`;
const PANEL = { id: EXTENSION_ID, url: `${ORIGIN}sidepanel/index.html` };
const CONTENT_SCRIPT = {
  id: EXTENSION_ID,
  url: "https://example.com/",
  tab: { id: 7 },
};

type Listener = (
  message: unknown,
  sender: unknown,
  sendResponse: (r: unknown) => void,
) => boolean | undefined;

function storageArea(initial: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = { ...initial };
  return {
    data,
    get: async (keys: string | string[]) => {
      const out: Record<string, unknown> = {};
      for (const k of Array.isArray(keys) ? keys : [keys]) {
        if (k in data) out[k] = data[k];
      }
      return out;
    },
    set: async (items: Record<string, unknown>) => {
      Object.assign(data, items);
    },
    remove: async (key: string) => {
      delete data[key];
    },
    setAccessLevel: vi.fn(async () => {}),
  };
}

let listeners: Listener[];
let local: ReturnType<typeof storageArea>;
let attach: ReturnType<typeof vi.fn>;

function install(initial: Record<string, unknown> = {}) {
  listeners = [];
  local = storageArea(initial);
  attach = vi.fn(async () => {});
  vi.stubGlobal("chrome", {
    storage: { local, session: storageArea() },
    debugger: {
      onDetach: { addListener: () => {} },
      attach,
      detach: async () => {},
      sendCommand: async () => ({}),
    },
    runtime: {
      id: EXTENSION_ID,
      getURL: (path: string) => `${ORIGIN}${path}`,
      onMessage: { addListener: (fn: Listener) => listeners.push(fn) },
    },
    tabs: { get: async () => ({ url: "https://example.com/" }) },
    extension: { isAllowedFileSchemeAccess: async () => false },
  });
}

/** Deliver a message the way Chrome does and wait for its answer, if any. */
async function send(
  message: unknown,
  sender: unknown,
): Promise<{ answered: boolean; response?: unknown }> {
  let response: unknown;
  let answered = false;
  const done = new Promise<void>((resolve) => {
    const keepOpen = listeners[0](message, sender, (r) => {
      response = r;
      answered = true;
      resolve();
    });
    if (keepOpen !== true) resolve();
  });
  await done;
  return { answered, response };
}

async function register() {
  vi.resetModules();
  const { registerNativeMode } = await import("./index.js");
  registerNativeMode();
  // Let the fire-and-forget migration and access-level calls settle.
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => install());
afterEach(() => vi.unstubAllGlobals());

describe("registerNativeMode: who may send native messages", () => {
  it("lets the side panel turn native mode on", async () => {
    await register();
    const { response } = await send(
      { type: "NATIVE_FLAG_SET", enabled: true },
      PANEL,
    );
    expect(response).toMatchObject({ enabled: true });
    expect(local.data["settings.nativeModeEnabled"]).toBe(true);
  });

  it("ignores a content script, which carries the extension's id too", async () => {
    await register();
    const { answered } = await send(
      { type: "NATIVE_FLAG_SET", enabled: true },
      CONTENT_SCRIPT,
    );
    expect(answered).toBe(false);
    expect(local.data["settings.nativeModeEnabled"]).toBeUndefined();
  });

  it("keeps chrome.storage.local out of content scripts' reach", async () => {
    await register();
    expect(local.setAccessLevel).toHaveBeenCalledWith({
      accessLevel: "TRUSTED_CONTEXTS",
    });
  });
});

describe("registerNativeMode: on by default", () => {
  // Native mode is on unless the user turned it off in the panel's
  // Settings: a profile that never touched the setting reads natively.
  const get = async () =>
    (await send({ type: "NATIVE_FLAG_GET" }, PANEL)).response;

  it("reads as on while the setting was never touched", async () => {
    await register();
    expect(await get()).toEqual({ enabled: true });
  });

  it("reads as off once turned off, and on again once turned back on", async () => {
    await register();
    await send({ type: "NATIVE_FLAG_SET", enabled: false }, PANEL);
    expect(await get()).toEqual({ enabled: false });
    await send({ type: "NATIVE_FLAG_SET", enabled: true }, PANEL);
    expect(await get()).toEqual({ enabled: true });
  });

  it("attaches for a read while the setting was never touched", async () => {
    await register();
    await send({ type: "NATIVE_READ", tabId: 7 }, PANEL);
    expect(attach).toHaveBeenCalled();
  });

  it("never attaches once the user turned it off", async () => {
    await register();
    await send({ type: "NATIVE_FLAG_SET", enabled: false }, PANEL);
    await send({ type: "NATIVE_READ", tabId: 7 }, PANEL);
    expect(attach).not.toHaveBeenCalled();
  });

  it("reads a stored value that isn't a boolean as on", async () => {
    install({ "settings.nativeModeEnabled": "false" });
    await register();
    expect(await get()).toEqual({ enabled: true });
  });

  it("refuses a change that isn't a boolean, and changes nothing", async () => {
    await register();
    await send({ type: "NATIVE_FLAG_SET", enabled: false }, PANEL);

    const { response } = await send({ type: "NATIVE_FLAG_SET" }, PANEL);

    expect(response).toEqual({ ok: false, error: "bad-request" });
    expect(local.data["settings.nativeModeEnabled"]).toBe(false);
    expect(await get()).toEqual({ enabled: false });
  });
});

describe("registerNativeMode: the old dogfood flag", () => {
  it("carries devFlags.nativeMode over and removes it", async () => {
    install({ "devFlags.nativeMode": true });
    await register();
    expect(local.data["settings.nativeModeEnabled"]).toBe(true);
    expect("devFlags.nativeMode" in local.data).toBe(false);
  });

  it("carries an old 'off' over, so native mode stays off", async () => {
    install({ "devFlags.nativeMode": false });
    await register();
    expect(local.data["settings.nativeModeEnabled"]).toBe(false);
    expect("devFlags.nativeMode" in local.data).toBe(false);
  });

  it("never writes over a Disable sent while it runs", async () => {
    // The panel's message is what wakes the worker, so a Disable can arrive
    // while the migration is still between its read and its write.
    install({ "devFlags.nativeMode": true });
    vi.resetModules();
    const { registerNativeMode } = await import("./index.js");
    registerNativeMode();
    await send({ type: "NATIVE_FLAG_SET", enabled: false }, PANEL);
    await new Promise((r) => setTimeout(r, 0));
    expect(local.data["settings.nativeModeEnabled"]).toBe(false);
    expect("devFlags.nativeMode" in local.data).toBe(false);
  });

  it("never overrides a setting the user already chose", async () => {
    install({
      "devFlags.nativeMode": true,
      "settings.nativeModeEnabled": false,
    });
    await register();
    expect(local.data["settings.nativeModeEnabled"]).toBe(false);
  });
});

describe("registerNativeMode: the dogfood event log in the store build", () => {
  it("has no report to give, and says so rather than hanging", async () => {
    await register();
    const { answered, response } = await send(
      { type: "NATIVE_DOGFOOD_REPORT" },
      PANEL,
    );
    expect(answered).toBe(true);
    expect(response).toEqual({ ok: false, error: "unsupported" });
  });

  it("writes nothing durable while native mode is used", async () => {
    await register();
    await send({ type: "NATIVE_FLAG_SET", enabled: true }, PANEL);
    await send({ type: "NATIVE_READ", tabId: 7 }, PANEL);
    const keys = Object.keys(local.data).filter((k) => k.startsWith("dogfood"));
    expect(keys).toEqual([]);
  });
});

describe("registerNativeMode: a read numbers the page for focus sync", () => {
  const PAGE_URL = "https://example.com/";
  // A page of one button: `DOM.getDocument`'s tree, and the AX tree over it.
  const dom = {
    nodeType: 9,
    backendNodeId: 1,
    documentURL: PAGE_URL,
    children: [
      {
        nodeType: 1,
        backendNodeId: 2,
        localName: "html",
        children: [
          {
            nodeType: 1,
            backendNodeId: 3,
            localName: "body",
            children: [{ nodeType: 1, backendNodeId: 30, localName: "button" }],
          },
        ],
      },
    ],
  };
  const ax = [
    {
      nodeId: "1",
      backendDOMNodeId: 1,
      role: { value: "RootWebArea" },
      childIds: ["3"],
    },
    {
      nodeId: "3",
      backendDOMNodeId: 30,
      parentId: "1",
      role: { value: "button" },
      name: { value: "Save" },
    },
  ];
  /** The top frame's content script's answer: the live page numbered as CDP
   *  numbers it, html 0, body 1, button 2. */
  let contentReply: () => Promise<unknown>;
  /** Other frames' answers, by frame; a frame with none has no content
   *  script to answer. */
  let frameReplies: Record<number, () => Promise<unknown>>;
  /** What `webNavigation.getAllFrames` lists. */
  let frames: () => Promise<unknown>;
  let sendMessage: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const { cdpPageKeys } = await import("./page-keys.js");
    const digest = cdpPageKeys(dom)!.digest;
    contentReply = async () => ({ ...digest, url: PAGE_URL });
    frameReplies = {};
    frames = async () => [{ frameId: 0, documentLifecycle: "active" }];
    sendMessage = vi.fn(
      (_tabId: number, _message: unknown, options?: { frameId?: number }) => {
        const frameId = options?.frameId ?? 0;
        if (frameId === 0) return contentReply();
        const reply = frameReplies[frameId];
        return reply
          ? reply()
          : Promise.reject(new Error("Receiving end does not exist."));
      },
    );
    const c = chrome as unknown as {
      debugger: { sendCommand: unknown };
      tabs: { sendMessage: unknown };
      webNavigation: unknown;
    };
    c.debugger.sendCommand = async (_target: unknown, method: string) =>
      method === "Accessibility.getFullAXTree"
        ? { nodes: ax }
        : method === "DOM.getDocument"
          ? { root: dom }
          : {};
    c.tabs.sendMessage = sendMessage;
    c.webNavigation = { getAllFrames: () => frames() };
  });

  type Read = {
    ok?: boolean;
    pageKeysReadId?: string;
    nodes?: Array<{
      name: string;
      role: string;
      pageKey?: number;
      pageFrame?: number;
      embedsPageFrame?: number;
    }>;
  };
  const read = async (pageKeys = true) =>
    (await send({ type: "NATIVE_READ", tabId: 7, pageKeys }, PANEL))
      .response as Read;
  /** The frames asked to number their document, in order. */
  const asked = () =>
    sendMessage.mock.calls.map(
      ([, , options]) => (options as { frameId: number }).frameId,
    );

  it("asks the top frame to number the page, under an id the read answers with", async () => {
    await register();
    const r = await read();
    expect(r.ok).toBe(true);
    expect(sendMessage).toHaveBeenCalledWith(
      7,
      { type: "NATIVE_PAGE_KEYS", payload: { readId: r.pageKeysReadId } },
      { frameId: 0 },
    );
    expect(r.pageKeysReadId).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.nodes?.find((n) => n.name === "Save")?.pageKey).toBe(2);
  });

  it("asks every frame showing a document to number its own, all under the read's id", async () => {
    frames = async () => [
      { frameId: 0, documentLifecycle: "active" },
      { frameId: 3, documentLifecycle: "active" },
      // Not the documents on screen.
      { frameId: 4, documentLifecycle: "prerender" },
      { frameId: 5, documentLifecycle: "cached" },
      // A Chrome too old to say.
      { frameId: 6 },
    ];
    await register();
    const r = await read();
    expect(asked()).toEqual([0, 3, 6]);
    const readIds = new Set(
      sendMessage.mock.calls.map(
        ([, message]) =>
          (message as { payload: { readId: string } }).payload.readId,
      ),
    );
    expect([...readIds]).toEqual([r.pageKeysReadId]);
  });

  it("asks the top frame alone when the tab's frames can't be listed", async () => {
    frames = () => Promise.reject(new Error("No tab with id: 7."));
    await register();
    const r = await read();
    expect(asked()).toEqual([0]);
    expect(r.nodes?.find((n) => n.name === "Save")?.pageKey).toBe(2);
  });

  it("asks the top frame before the tab's frames are listed, and the rest once they are", async () => {
    let list: (frames: unknown) => void = () => {};
    frames = () => new Promise((resolve) => (list = resolve));
    await register();
    const pending = read();
    await vi.waitFor(() => expect(asked()).toEqual([0]));
    list([{ frameId: 0 }, { frameId: 3 }]);
    const r = await pending;
    expect(asked()).toEqual([0, 3]);
    expect(r.nodes?.find((n) => n.name === "Save")?.pageKey).toBe(2);
  });

  it("numbers the top frame's document without waiting on frames that are never listed", async () => {
    frames = () => new Promise(() => {});
    await register();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const pending = read();
      await vi.advanceTimersByTimeAsync(2_000);
      const r = await pending;
      expect(asked()).toEqual([0]);
      expect(r.nodes?.find((n) => n.name === "Save")?.pageKey).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("asks no more than 32 frames, the top one among them", async () => {
    frames = async () =>
      Array.from({ length: 50 }, (_, i) => ({ frameId: 49 - i }));
    await register();
    await read();
    expect(asked()).toHaveLength(32);
    expect(asked()[0]).toBe(0);
  });

  it("numbers a frame's rows, and gives its <iframe> row the frame it shows", async () => {
    // The page with a frame in the same renderer under an <iframe> (40):
    // html 0, body 1, button 2, iframe 3; the frame's html 0, body 1,
    // button 2.
    const FRAME_URL = "https://example.com/frame";
    const frameDom = {
      nodeType: 9,
      backendNodeId: 50,
      documentURL: FRAME_URL,
      children: [
        {
          nodeType: 1,
          backendNodeId: 51,
          localName: "html",
          children: [
            {
              nodeType: 1,
              backendNodeId: 52,
              localName: "body",
              children: [
                { nodeType: 1, backendNodeId: 55, localName: "button" },
              ],
            },
          ],
        },
      ],
    };
    const page = structuredClone(dom);
    page.children[0]!.children[0]!.children.push({
      nodeType: 1,
      backendNodeId: 40,
      localName: "iframe",
      contentDocument: frameDom,
    } as (typeof page.children)[0]["children"][0]["children"][0]);
    const { cdpPageKeys } = await import("./page-keys.js");
    contentReply = async () => ({
      ...cdpPageKeys(page)!.digest,
      url: PAGE_URL,
    });
    frameReplies = {
      3: async () => ({ ...cdpPageKeys(frameDom)!.digest, url: FRAME_URL }),
    };
    frames = async () => [{ frameId: 0 }, { frameId: 3 }];
    const c = chrome as unknown as { debugger: { sendCommand: unknown } };
    c.debugger.sendCommand = async (
      _target: unknown,
      method: string,
      params?: { frameId?: string },
    ) => {
      if (method === "Accessibility.getFullAXTree") {
        return params?.frameId === "F"
          ? {
              nodes: [
                {
                  nodeId: "50",
                  role: { value: "RootWebArea" },
                  childIds: ["55"],
                },
                {
                  nodeId: "55",
                  backendDOMNodeId: 55,
                  parentId: "50",
                  role: { value: "button" },
                  name: { value: "Inner save" },
                },
              ],
            }
          : {
              nodes: [
                { ...ax[0]!, childIds: ["3", "40"] },
                ax[1]!,
                {
                  nodeId: "40",
                  backendDOMNodeId: 40,
                  parentId: "1",
                  role: { value: "Iframe" },
                  name: { value: "Frame" },
                },
              ],
            };
      }
      if (method === "Page.getFrameTree") {
        return {
          frameTree: {
            frame: { id: "TOP" },
            childFrames: [{ frame: { id: "F" } }],
          },
        };
      }
      if (method === "DOM.getFrameOwner") {
        return params?.frameId === "F" ? { backendNodeId: 40 } : {};
      }
      if (method === "DOM.getDocument") return { root: page };
      return {};
    };
    await register();
    const r = await read();
    const inner = r.nodes?.find((n) => n.name === "Inner save");
    expect([inner?.pageKey, inner?.pageFrame]).toEqual([2, 3]);
    const owner = r.nodes?.find((n) => n.role === "Iframe");
    expect([owner?.pageKey, owner?.embedsPageFrame]).toEqual([3, 3]);
    expect(r.nodes?.find((n) => n.name === "Save")?.pageFrame).toBeUndefined();
  });

  it("numbers nothing unless the panel asks: Focus sync is off", async () => {
    await register();
    const r = await read(false);
    expect(r.ok).toBe(true);
    expect(r.pageKeysReadId).toBeUndefined();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("names a new numbering on every read", async () => {
    await register();
    const first = (await read()).pageKeysReadId;
    const second = (await read()).pageKeysReadId;
    expect(second).not.toBe(first);
  });

  it("answers with no numbering when the content script numbered the page differently, or not at all", async () => {
    await register();
    const { cdpPageKeys } = await import("./page-keys.js");
    for (const reply of [
      async () => ({ count: 1, hash: 1, url: PAGE_URL }),
      // A digest it can't be matched by.
      async () => cdpPageKeys(dom)!.digest,
      async () => null,
      async () => {
        throw new Error("Receiving end does not exist.");
      },
    ]) {
      contentReply = reply;
      const r = await read();
      expect(r.ok).toBe(true);
      expect(r.pageKeysReadId).toBeUndefined();
      expect(r.nodes?.find((n) => n.name === "Save")?.pageKey).toBeUndefined();
    }
  });

  it("doesn't wait on a content script that never answers", async () => {
    await register();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      contentReply = () => new Promise(() => {});
      const pending = read();
      await vi.advanceTimersByTimeAsync(2_000);
      const r = await pending;
      expect(r.ok).toBe(true);
      expect(r.pageKeysReadId).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("numbers what answered in time when one frame never does", async () => {
    frames = async () => [{ frameId: 0 }, { frameId: 3 }];
    frameReplies = { 3: () => new Promise(() => {}) };
    await register();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const pending = read();
      await vi.advanceTimersByTimeAsync(2_000);
      const r = await pending;
      expect(r.pageKeysReadId).toBeDefined();
      expect(r.nodes?.find((n) => n.name === "Save")?.pageKey).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
