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

function install(initial: Record<string, unknown> = {}) {
  listeners = [];
  local = storageArea(initial);
  vi.stubGlobal("chrome", {
    storage: { local, session: storageArea() },
    debugger: {
      onDetach: { addListener: () => {} },
      attach: async () => {},
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

describe("registerNativeMode: whether the user has chosen", () => {
  // The panel asks on its first connect only while the setting has never
  // been set either way, so the reply has to tell "never asked" apart from
  // "chose the DOM tree".
  const get = async () =>
    (await send({ type: "NATIVE_FLAG_GET" }, PANEL)).response;

  it("reads as off and unchosen before any answer", async () => {
    await register();
    expect(await get()).toEqual({ enabled: false, chosen: false });
  });

  it("remembers a choice of the DOM tree as chosen", async () => {
    await register();
    await send({ type: "NATIVE_FLAG_SET", enabled: false }, PANEL);
    expect(await get()).toEqual({ enabled: false, chosen: true });
  });

  it("reports native mode turned on", async () => {
    await register();
    await send({ type: "NATIVE_FLAG_SET", enabled: true }, PANEL);
    expect(await get()).toEqual({ enabled: true, chosen: true });
  });

  it("counts a dogfooder's carried-over flag as their choice", async () => {
    install({ "devFlags.nativeMode": true });
    await register();
    expect(await get()).toEqual({ enabled: true, chosen: true });
  });

  it("leaves a dropped old 'off' unchosen, so the panel still asks", async () => {
    install({ "devFlags.nativeMode": false });
    await register();
    expect(await get()).toEqual({ enabled: false, chosen: false });
  });
});

describe("registerNativeMode: the old dogfood flag", () => {
  it("carries devFlags.nativeMode over and removes it", async () => {
    install({ "devFlags.nativeMode": true });
    await register();
    expect(local.data["settings.nativeModeEnabled"]).toBe(true);
    expect("devFlags.nativeMode" in local.data).toBe(false);
  });

  it("drops an old 'off' without turning anything on", async () => {
    install({ "devFlags.nativeMode": false });
    await register();
    expect(local.data["settings.nativeModeEnabled"]).toBeUndefined();
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
