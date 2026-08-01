/**
 * Curtain state must survive an MV3 service-worker death.
 *
 * Chrome kills the background service worker after ~30s idle even while the
 * side panel is open. Everything in module scope dies with it. The screen
 * curtain is the one piece of that state the *page* keeps after the worker is
 * gone — the overlay is painted in the content script — so a revived worker
 * that has forgotten which tabs are curtained will skip `TOGGLE_CURTAIN(false)`
 * on panel close and strand the user behind a black overlay with no UI to
 * dismiss it.
 *
 * `vi.resetModules()` + re-import models the death exactly: fresh module
 * globals, same `chrome` (and therefore same `chrome.storage.session`, which
 * outlives the worker).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const OWN_ID = "ownextensionid";

type Listener = (...args: unknown[]) => unknown;

interface SentToTab {
  tabId: number;
  message: { type: string; payload?: Record<string, unknown> };
}

interface Harness {
  sent: SentToTab[];
  connectPanel: () => { disconnect: () => void };
  panelMessage: (message: Record<string, unknown>) => void;
  flush: () => Promise<void>;
}

/** Session storage persists across worker deaths — one instance for the run. */
let sessionStore: Record<string, unknown> = {};

function mkEvent(capture?: (fn: Listener) => void) {
  return {
    addListener: (fn: Listener) => capture?.(fn),
    removeListener: () => {},
    hasListener: () => false,
  };
}

/** Boot a fresh background service-worker instance against a shared `chrome`. */
async function bootServiceWorker(): Promise<Harness> {
  const sent: SentToTab[] = [];
  let onMessage!: (
    m: unknown,
    s: unknown,
    r: (resp?: unknown) => void,
  ) => unknown;
  let onConnect!: (port: unknown) => void;

  const chromeMock = {
    runtime: {
      id: OWN_ID,
      lastError: undefined,
      onMessage: mkEvent((fn) => {
        onMessage = fn as typeof onMessage;
      }),
      onConnect: mkEvent((fn) => {
        onConnect = fn as typeof onConnect;
      }),
      sendMessage: () => Promise.resolve(),
    },
    action: { onClicked: mkEvent() },
    sidePanel: { open: () => {}, setPanelBehavior: () => Promise.resolve() },
    storage: {
      session: {
        get: (keys: string[] | string | null) => {
          if (typeof keys === "string")
            return Promise.resolve({ [keys]: sessionStore[keys] });
          return Promise.resolve({ ...sessionStore });
        },
        set: (items: Record<string, unknown>) => {
          Object.assign(sessionStore, items);
          return Promise.resolve();
        },
        remove: (key: string) => {
          delete sessionStore[key];
          return Promise.resolve();
        },
      },
    },
    tabs: {
      onActivated: mkEvent(),
      onRemoved: mkEvent(),
      query: (_q: unknown, cb?: (t: { id: number }[]) => void) => {
        const tabs = [{ id: 7, windowId: 1 }];
        if (cb) return cb(tabs);
        return Promise.resolve(tabs);
      },
      sendMessage: (
        tabId: number,
        message: SentToTab["message"],
        a?: unknown,
        b?: unknown,
      ) => {
        sent.push({ tabId, message });
        const cb = typeof a === "function" ? a : b;
        if (typeof cb === "function") (cb as (r?: unknown) => void)({});
      },
      remove: (_id: number, cb: () => void) => cb(),
    },
    windows: {
      WINDOW_ID_NONE: -1,
      onFocusChanged: mkEvent(),
      update: () => {},
    },
    webNavigation: {
      onBeforeNavigate: mkEvent(),
      // Tab 7 is a single-frame page.
      getAllFrames: () => Promise.resolve([{ frameId: 0 }]),
    },
  };

  (globalThis as Record<string, unknown>).chrome = chromeMock;
  vi.resetModules();
  await import("./background.js");

  const flush = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };

  return {
    sent,
    connectPanel: () => {
      const disconnectListeners: Listener[] = [];
      const port = {
        name: "sidepanel",
        onDisconnect: mkEvent((fn) => disconnectListeners.push(fn)),
      };
      onConnect(port);
      return {
        disconnect: () => disconnectListeners.forEach((fn) => fn()),
      };
    },
    panelMessage: (message) => {
      onMessage({ ...message, tabId: 7 }, { id: OWN_ID }, () => {});
    },
    flush,
  };
}

describe("screen curtain across a service-worker death", () => {
  beforeEach(() => {
    sessionStore = {};
  });

  it("lifts the curtain on panel close when the worker never died (baseline)", async () => {
    const sw = await bootServiceWorker();
    const panel = sw.connectPanel();
    sw.panelMessage({ type: "TOGGLE_CURTAIN", payload: { visible: true } });
    await sw.flush();

    sw.sent.length = 0;
    panel.disconnect();
    await sw.flush();

    const lift = sw.sent.filter(
      (s) =>
        s.message.type === "TOGGLE_CURTAIN" &&
        s.message.payload?.visible === false,
    );
    expect(lift.map((s) => s.tabId)).toContain(7);
  });

  it("lifts the curtain on panel close AFTER the worker died and revived", async () => {
    // Worker instance A: user turns the curtain on.
    const swA = await bootServiceWorker();
    const panelA = swA.connectPanel();
    swA.panelMessage({ type: "TOGGLE_CURTAIN", payload: { visible: true } });
    await swA.flush();
    expect(swA.sent).toContainEqual(
      expect.objectContaining({
        tabId: 7,
        message: expect.objectContaining({ type: "TOGGLE_CURTAIN" }),
      }),
    );
    void panelA;

    // ~30s idle: Chrome kills the worker. Module globals are gone; the page
    // still has the curtain painted, and the panel reconnects its port.
    const swB = await bootServiceWorker();
    const panelB = swB.connectPanel();
    await swB.flush();

    // User closes the panel.
    swB.sent.length = 0;
    panelB.disconnect();
    await swB.flush();

    const lift = swB.sent.filter(
      (s) =>
        s.message.type === "TOGGLE_CURTAIN" &&
        s.message.payload?.visible === false,
    );
    expect(lift.map((s) => s.tabId)).toContain(7);
  });
});
