/**
 * SPIKE — MV3 service worker for the chrome.debugger native-tree spike.
 *
 * Wraps `chrome.debugger.sendCommand` as a `CdpTransport` and exposes a tiny
 * API on `globalThis.__spike` that the Playwright test drives via
 * `serviceWorker.evaluate(...)`. All returned values are JSON-serializable.
 *
 * Everything AX-related lives in native-core.ts — this file is ONLY the
 * chrome.debugger plumbing, i.e. exactly the surface a product
 * "extension native mode" would have to add.
 */

import {
  clickByBackendId,
  findNode,
  readNativeTree,
  type CdpTransport,
  type ClickResult,
  type NativeTreeResult,
} from "./native-core.js";

function transportFor(tabId: number): CdpTransport {
  return {
    send: <T>(method: string, params?: object) =>
      chrome.debugger.sendCommand({ tabId }, method, params) as Promise<T>,
  };
}

/** Attach → run → always detach. One attach per operation, like a product
 * session would scope it (banner shows only while attached). */
async function withDebugger<T>(
  tabId: number,
  fn: (t: CdpTransport) => Promise<T>,
): Promise<T> {
  await chrome.debugger.attach({ tabId }, "1.3");
  try {
    return await fn(transportFor(tabId));
  } finally {
    await chrome.debugger.detach({ tabId }).catch(() => {
      // Tab may already be gone; nothing actionable.
    });
  }
}

const spike = {
  /** Find the fixture tab by URL prefix (the test serves it on loopback). */
  async findTab(urlPrefix: string): Promise<number | null> {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((t) => (t.url ?? "").startsWith(urlPrefix));
    return tab?.id ?? null;
  },

  async readTree(tabId: number): Promise<NativeTreeResult> {
    return withDebugger(tabId, readNativeTree);
  },

  /** One attached session: read → click(role, name) → re-read. */
  async session(
    tabId: number,
    role: string,
    nameIncludes: string,
  ): Promise<{
    before: string;
    click: ClickResult | { ok: false; error: "target-not-found" };
    after: string;
  }> {
    return withDebugger(tabId, async (t) => {
      const before = await readNativeTree(t);
      const target = findNode(before.nodes, role, nameIncludes);
      if (!target) {
        return {
          before: before.serialized,
          click: { ok: false as const, error: "target-not-found" as const },
          after: before.serialized,
        };
      }
      const click = await clickByBackendId(t, target.backendDOMNodeId);
      const after = await readNativeTree(t);
      return { before: before.serialized, click, after: after.serialized };
    });
  },

  /** Probe debugger exclusivity: what does a second attach report? */
  async doubleAttach(tabId: number): Promise<{ secondAttach: string }> {
    await chrome.debugger.attach({ tabId }, "1.3");
    try {
      await chrome.debugger.attach({ tabId }, "1.3");
      return { secondAttach: "unexpectedly-succeeded" };
    } catch (err) {
      return { secondAttach: err instanceof Error ? err.message : String(err) };
    } finally {
      await chrome.debugger.detach({ tabId }).catch(() => {});
    }
  },
};

declare global {
  var __spike: typeof spike;
}
globalThis.__spike = spike;
