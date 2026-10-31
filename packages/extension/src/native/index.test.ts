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
    remove: async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key];
    },
    setAccessLevel: vi.fn(async () => {}),
  };
}

let listeners: Listener[];
let local: ReturnType<typeof storageArea>;
let attach: ReturnType<typeof vi.fn>;
let detach: ReturnType<typeof vi.fn>;

function install(
  initial: Record<string, unknown> = {},
  session: Record<string, unknown> = {},
) {
  listeners = [];
  local = storageArea(initial);
  attach = vi.fn(async () => {});
  detach = vi.fn(async () => {});
  vi.stubGlobal("chrome", {
    storage: { local, session: storageArea(session) },
    debugger: {
      onDetach: { addListener: () => {} },
      attach,
      detach,
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
  const mod = await import("./index.js");
  mod.registerNativeMode();
  // Let the fire-and-forget access-level call settle.
  await new Promise((r) => setTimeout(r, 0));
  return mod;
}

beforeEach(() => install());
afterEach(() => vi.unstubAllGlobals());

describe("registerNativeMode: who may send native messages", () => {
  it("answers the side panel", async () => {
    await register();
    const { response } = await send(
      { type: "NATIVE_CAPABILITY", tabId: 7 },
      PANEL,
    );
    expect(response).toEqual({ native: true });
  });

  it("ignores a content script, which carries the extension's id too", async () => {
    await register();
    const { answered } = await send(
      { type: "NATIVE_CAPABILITY", tabId: 7 },
      CONTENT_SCRIPT,
    );
    expect(answered).toBe(false);
    await send({ type: "NATIVE_READ", tabId: 7 }, CONTENT_SCRIPT);
    expect(attach).not.toHaveBeenCalled();
  });

  it("keeps chrome.storage.local out of content scripts' reach", async () => {
    await register();
    expect(local.setAccessLevel).toHaveBeenCalledWith({
      accessLevel: "TRUSTED_CONTEXTS",
    });
  });
});

describe("registerNativeMode: reads", () => {
  it("attaches for a read", async () => {
    await register();
    await send({ type: "NATIVE_READ", tabId: 7 }, PANEL);
    expect(attach).toHaveBeenCalled();
  });

  it("attaches where an older version stored native mode off, and clears what it stored", async () => {
    // The setting is gone: a stored "off" from before counts for nothing,
    // and is removed, with the key it was migrated from.
    install({
      "settings.nativeModeEnabled": false,
      "devFlags.nativeMode": false,
      "settings.showFullNames": true,
    });
    await register();
    await send({ type: "NATIVE_READ", tabId: 7 }, PANEL);
    expect(attach).toHaveBeenCalled();
    expect("settings.nativeModeEnabled" in local.data).toBe(false);
    expect("devFlags.nativeMode" in local.data).toBe(false);
    expect(local.data["settings.showFullNames"]).toBe(true);
  });

  it("no longer answers the setting's messages", async () => {
    await register();
    for (const message of [
      { type: "NATIVE_FLAG_GET" },
      { type: "NATIVE_FLAG_SET", enabled: false },
    ]) {
      const { response } = await send(message, PANEL);
      expect(response).toEqual({ ok: false, error: "unsupported" });
    }
    expect(local.data["settings.nativeModeEnabled"]).toBeUndefined();
  });
});

describe("releaseDebugger: the last side panel closes", () => {
  it("detaches a tab an MV3 suspend left attached", async () => {
    // Nothing reads the tab once the panel is gone, so nothing would detach
    // it, and Chrome's bar would stay up.
    install({}, { "dogfood.attachedTabs": { 7: Date.now() } });
    const { releaseDebugger } = await register();
    releaseDebugger();
    await vi.waitFor(() => expect(detach).toHaveBeenCalledWith({ tabId: 7 }));
  });

  it("detaches nothing while nothing is attached", async () => {
    const { releaseDebugger } = await register();
    releaseDebugger();
    await new Promise((r) => setTimeout(r, 0));
    expect(detach).not.toHaveBeenCalled();
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
      { frameId: 0, url: PAGE_URL, documentLifecycle: "active" },
      { frameId: 3, url: "https://a.test/", documentLifecycle: "active" },
      // Not the documents on screen.
      { frameId: 4, url: "https://b.test/", documentLifecycle: "prerender" },
      { frameId: 5, url: "https://c.test/", documentLifecycle: "cached" },
      // A Chrome too old to say.
      { frameId: 6, url: "https://d.test/" },
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

  it("asks no frame the content script can't run in, so none takes the place of one it can", async () => {
    frames = async () => [
      { frameId: 0, url: PAGE_URL },
      ...Array.from({ length: 40 }, (_, i) => ({
        frameId: 100 + i,
        url: `data:text/html,<p>${i}</p>`,
      })),
      { frameId: 3, url: "blob:https://a.test/0b9f" },
      { frameId: 4, url: "chrome-error://chromewebdata/" },
      // An error page, at the URL it failed to load.
      { frameId: 5, url: "https://a.test/gone", errorOccurred: true },
      { frameId: 6, url: "file:///tmp/page.html" },
      { frameId: 7, url: "https://a.test/video" },
    ];
    await register();
    await read();
    expect(asked()).toEqual([0, 6, 7]);
  });

  it("asks the frames with no URL of their own, which the content script runs in too", async () => {
    frames = async () => [
      { frameId: 0, url: PAGE_URL },
      { frameId: 3, url: "about:blank" },
      { frameId: 4, url: "about:srcdoc" },
      { frameId: 5, url: "https://a.test/video" },
    ];
    await register();
    await read();
    expect(asked().sort()).toEqual([0, 3, 4, 5]);
  });

  it("asks them after the frames known to be in the tree, and ahead of those known not to be", async () => {
    // Dozens of blank ad frames, listed first. Which of them the tree holds
    // can't be told by a URL they all share, where a frame with a URL of
    // its own is known by it: the one with rows keeps its place, and the
    // hidden ones give theirs up.
    const frameUrl = await withFrame();
    frames = async () => [
      { frameId: 0, url: PAGE_URL },
      ...Array.from({ length: 40 }, (_, i) => ({
        frameId: 100 + i,
        url: i % 2 ? "about:blank" : "about:srcdoc",
      })),
      { frameId: 8, url: "https://sync.test/hidden" },
      { frameId: 3, url: frameUrl },
    ];
    await register();
    const r = await read();
    expect(asked()).toHaveLength(32);
    expect(asked().slice(0, 2)).toEqual([0, 3]);
    expect(asked()).not.toContain(8);
    const inner = r.nodes?.find((n) => n.name === "Inner save");
    expect([inner?.pageKey, inner?.pageFrame]).toEqual([2, 3]);
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
    list([
      { frameId: 0, url: PAGE_URL },
      { frameId: 3, url: "https://a.test/" },
    ]);
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
      Array.from({ length: 50 }, (_, i) => ({
        frameId: 49 - i,
        url: `https://a.test/${i}`,
      }));
    await register();
    await read();
    expect(asked()).toHaveLength(32);
    expect(asked()[0]).toBe(0);
  });

  /**
   * The page with a frame in the same renderer under an <iframe> (40),
   * whose content script answers as frame 3. `urlInTree` false leaves the
   * frame's URL out of CDP's frame tree, so the read can't tell the
   * numbering the frame is in the tree.
   */
  async function withFrame({ urlInTree = true } = {}): Promise<string> {
    // Numbered html 0, body 1, button 2, iframe 3; the frame's html 0,
    // body 1, button 2.
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
            childFrames: [
              { frame: { id: "F", ...(urlInTree ? { url: FRAME_URL } : {}) } },
            ],
          },
        };
      }
      if (method === "DOM.getFrameOwner") {
        return params?.frameId === "F" ? { backendNodeId: 40 } : {};
      }
      if (method === "DOM.getDocument") return { root: page };
      return {};
    };
    return FRAME_URL;
  }

  it("numbers a frame's rows, and gives its <iframe> row the frame it shows", async () => {
    const frameUrl = await withFrame();
    frames = async () => [
      { frameId: 0, url: PAGE_URL },
      { frameId: 3, url: frameUrl },
    ];
    await register();
    const r = await read();
    const inner = r.nodes?.find((n) => n.name === "Inner save");
    expect([inner?.pageKey, inner?.pageFrame]).toEqual([2, 3]);
    const owner = r.nodes?.find((n) => n.role === "Iframe");
    expect([owner?.pageKey, owner?.embedsPageFrame]).toEqual([3, 3]);
    expect(r.nodes?.find((n) => n.name === "Save")?.pageFrame).toBeUndefined();
  });

  it("asks the frames the read put in the tree first, ahead of hidden ones listed before them", async () => {
    const frameUrl = await withFrame();
    // Dozens of hidden sync frames, listed ahead of the one with rows.
    frames = async () => [
      { frameId: 0, url: PAGE_URL },
      ...Array.from({ length: 40 }, (_, i) => ({
        frameId: 100 + i,
        url: `https://sync.test/${i}`,
      })),
      { frameId: 3, url: frameUrl },
    ];
    await register();
    const r = await read();
    expect(asked()).toHaveLength(32);
    expect(asked().slice(0, 2)).toEqual([0, 3]);
    const inner = r.nodes?.find((n) => n.name === "Inner save");
    expect([inner?.pageKey, inner?.pageFrame]).toEqual([2, 3]);
  });

  it("gives a frame the read put in the tree as long as the top frame", async () => {
    // A big frame sharing the top frame's renderer walks once the read's
    // own walk is done: it isn't held to the moment a hidden frame gets.
    const frameUrl = await withFrame();
    const reply = frameReplies[3]!;
    frameReplies = {
      3: () => new Promise((r) => setTimeout(() => r(reply()), 1_000)),
    };
    frames = async () => [
      { frameId: 0, url: PAGE_URL },
      { frameId: 3, url: frameUrl },
    ];
    await register();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      let done = false;
      const pending = read().then((r) => {
        done = true;
        return r;
      });
      await vi.advanceTimersByTimeAsync(500);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(600);
      const r = await pending;
      const inner = r.nodes?.find((n) => n.name === "Inner save");
      expect([inner?.pageKey, inner?.pageFrame]).toEqual([2, 3]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives the other frames their moment from when they're listed, not before", async () => {
    // The browser is slow to list the frames: a frame asked only then
    // still gets its quarter of a second.
    const frameUrl = await withFrame({ urlInTree: false });
    const reply = frameReplies[3]!;
    frameReplies = {
      3: () => new Promise((r) => setTimeout(() => r(reply()), 100)),
    };
    frames = () =>
      new Promise((r) =>
        setTimeout(
          () =>
            r([
              { frameId: 0, url: PAGE_URL },
              { frameId: 3, url: frameUrl },
            ]),
          300,
        ),
      );
    await register();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const pending = read();
      await vi.advanceTimersByTimeAsync(700);
      const r = await pending;
      const inner = r.nodes?.find((n) => n.name === "Inner save");
      expect([inner?.pageKey, inner?.pageFrame]).toEqual([2, 3]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("counts no error page at a frame's URL: it shows no document there", async () => {
    const frameUrl = await withFrame();
    frames = async () => [
      { frameId: 0, url: PAGE_URL },
      { frameId: 3, url: frameUrl },
      { frameId: 4, url: frameUrl, errorOccurred: true },
    ];
    await register();
    const r = await read();
    expect(asked()).toEqual([0, 3]);
    const inner = r.nodes?.find((n) => n.name === "Inner save");
    expect([inner?.pageKey, inner?.pageFrame]).toEqual([2, 3]);
  });

  it("counts a frame at the same URL past the frames it asks, as one that kept silent", async () => {
    const frameUrl = await withFrame({ urlInTree: false });
    frames = async () => [
      { frameId: 0, url: PAGE_URL },
      { frameId: 3, url: frameUrl },
      ...Array.from({ length: 40 }, (_, i) => ({
        frameId: 100 + i,
        url: `https://sync.test/${i}`,
      })),
      { frameId: 4, url: frameUrl },
    ];
    await register();
    const r = await read();
    expect(asked()).toHaveLength(32);
    expect(asked()).not.toContain(4);
    expect(
      r.nodes?.find((n) => n.name === "Inner save")?.pageKey,
    ).toBeUndefined();
  });

  it("numbers no frame while another at its URL keeps silent: the document may be that one's", async () => {
    const frameUrl = await withFrame();
    // Frame 4 shows the same URL, and has no content script to answer.
    frames = async () => [
      { frameId: 0, url: PAGE_URL },
      { frameId: 3, url: frameUrl },
      { frameId: 4, url: frameUrl },
    ];
    await register();
    const r = await read();
    expect(asked()).toEqual([0, 3, 4]);
    const inner = r.nodes?.find((n) => n.name === "Inner save");
    expect(inner?.pageKey).toBeUndefined();
    const owner = r.nodes?.find((n) => n.role === "Iframe");
    expect(owner?.embedsPageFrame).toBeUndefined();
    expect(r.nodes?.find((n) => n.name === "Save")?.pageKey).toBe(2);
  });

  it("numbers a frame showing the page's own URL as the top frame's child, when the page's walks disagree", async () => {
    // The frame's document is at the page's URL on both sides, as a page
    // that embeds itself has it. The top document's own walk disagrees, so
    // no mark can be gone by, and the frame is matched by URL only as the
    // child of the top frame the tab lists it as.
    await withFrame();
    const c = chrome as unknown as {
      debugger: {
        sendCommand: (
          target: unknown,
          method: string,
          params?: object,
        ) => Promise<unknown>;
      };
    };
    const sendCommand = c.debugger.sendCommand;
    c.debugger.sendCommand = async (target, method, params) => {
      const result = await sendCommand(target, method, params);
      if (method !== "DOM.getDocument") return result;
      const page = structuredClone(result) as {
        root: { children: Array<{ children: Array<{ children: object[] }> }> };
      };
      const iframe = page.root.children[0]!.children[0]!.children[1] as {
        contentDocument: { documentURL: string };
      };
      iframe.contentDocument.documentURL = PAGE_URL;
      return page;
    };
    const top = contentReply;
    const inner = frameReplies[3]!;
    contentReply = async () => ({ ...((await top()) as object), count: 99 });
    frameReplies = {
      3: async () => ({ ...((await inner()) as object), url: PAGE_URL }),
    };
    const innerOf = (r: Read) => r.nodes?.find((n) => n.name === "Inner save");

    frames = async () => [
      { frameId: 0, parentFrameId: -1, url: PAGE_URL },
      { frameId: 3, parentFrameId: 0, url: PAGE_URL },
    ];
    await register();
    const r = await read();
    expect([innerOf(r)?.pageKey, innerOf(r)?.pageFrame]).toEqual([2, 3]);
    expect(r.nodes?.find((n) => n.name === "Save")?.pageKey).toBeUndefined();

    // Listed as another frame's child, it isn't the one under this <iframe>.
    frames = async () => [
      { frameId: 0, parentFrameId: -1, url: PAGE_URL },
      { frameId: 3, parentFrameId: 8, url: PAGE_URL },
    ];
    expect(innerOf(await read())?.pageKey).toBeUndefined();
  });

  describe("a frame with no URL of its own", () => {
    /**
     * `withFrame`'s page, its frame one the page wrote into
     * (`document.open()`): CDP and the frame's own script both have its
     * document at a URL, the one of the document that wrote it, while the
     * tab lists the frame at `about:blank`.
     */
    async function withWrittenFrame(): Promise<void> {
      await withFrame();
      frames = async () => [
        { frameId: 0, url: PAGE_URL },
        { frameId: 3, url: "about:blank" },
      ];
    }
    /** The two frames' answers: the top frame's walk found `held` on its
     *  <iframe>, number 3, and the frame answers with `owner`. */
    function marks(held: string | undefined, owner: string | undefined): void {
      const top = contentReply;
      const inner = frameReplies[3]!;
      contentReply = async () => ({
        ...((await top()) as object),
        ...(held !== undefined ? { embeds: [[3, held]] } : {}),
      });
      frameReplies = {
        3: async () => ({
          ...((await inner()) as object),
          ...(owner !== undefined ? { owner } : {}),
        }),
      };
    }
    const innerOf = (r: Read) => r.nodes?.find((n) => n.name === "Inner save");

    it("is numbered by the mark its script left on its <iframe>", async () => {
      await withWrittenFrame();
      marks("mark-a", "mark-a");
      await register();
      const r = await read();
      expect(asked()).toEqual([0, 3]);
      expect([innerOf(r)?.pageKey, innerOf(r)?.pageFrame]).toEqual([2, 3]);
      expect(r.nodes?.find((n) => n.role === "Iframe")?.embedsPageFrame).toBe(
        3,
      );
    });

    it("is never numbered by its document's URL, though no other frame shows it", async () => {
      // No mark the read can go by: the frame's script loaded after the top
      // frame's walk, or the two disagree on it. The document's URL and its
      // numbering agree on both sides all along.
      for (const [held, owner] of [
        [undefined, undefined],
        [undefined, "mark-a"],
        ["mark-a", "mark-b"],
      ] as const) {
        await withWrittenFrame();
        marks(held, owner);
        await register();
        const r = await read();
        expect(innerOf(r)?.pageKey, `${held} ${owner}`).toBeUndefined();
        expect(r.nodes?.find((n) => n.name === "Save")?.pageKey).toBe(2);
      }
    });
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

  it("gives a frame that hasn't answered only a moment once the top frame has and the read's walk is in", async () => {
    // A busy frame, a hidden ad frame in a long task say, holds the read
    // up a quarter of a second, not the whole time the top frame gets.
    frames = async () => [
      { frameId: 0, url: PAGE_URL },
      { frameId: 3, url: "https://a.test/busy" },
    ];
    frameReplies = { 3: () => new Promise(() => {}) };
    await register();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      let done = false;
      const pending = read().then((r) => {
        done = true;
        return r;
      });
      await vi.advanceTimersByTimeAsync(200);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(100);
      expect(done).toBe(true);
      const r = await pending;
      expect(asked()).toEqual([0, 3]);
      expect(r.pageKeysReadId).toBeDefined();
      expect(r.nodes?.find((n) => n.name === "Save")?.pageKey).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
