import type { SemanticNode } from "@real-a11y-dev/core";

import type { ContentToPanel, PanelToContent } from "../types.js";

/**
 * Shared jsdom harness for the side-panel tests that mount the whole `App`:
 * a `chrome.runtime` stand-in, a small tree fixture, and the `matchMedia` stub
 * jsdom doesn't ship. Not a `.test.ts` file on purpose — vitest's `include`
 * would otherwise pick it up as a suite with no tests in it.
 */

export const EXTENSION_ID = "test-extension-id";
export const TAB_ID = 7;

export interface ChromeMock {
  sent: PanelToContent[];
  emit: (message: ContentToPanel) => void;
}

export function installChromeMock(): ChromeMock {
  type Listener = (
    message: ContentToPanel,
    sender: chrome.runtime.MessageSender,
  ) => void;
  const listeners: Listener[] = [];
  const sent: PanelToContent[] = [];

  const runtime = {
    id: EXTENSION_ID,
    lastError: undefined,
    getManifest: () => ({ version: "0.0.0-test" }),
    connect: () => ({
      onDisconnect: { addListener: () => {} },
      disconnect: () => {},
    }),
    sendMessage: (
      message: PanelToContent,
      responseCallback?: (response: unknown) => void,
    ) => {
      sent.push(message);
      // An ordinary reachable page: `isUnreachablePageResponse` reads
      // `unreachable`, and leaving it unset is what such a page replies.
      responseCallback?.({ success: true });
    },
    onMessage: {
      addListener: (fn: Listener) => listeners.push(fn),
      removeListener: (fn: Listener) => {
        const i = listeners.indexOf(fn);
        if (i !== -1) listeners.splice(i, 1);
      },
    },
  };

  (globalThis as unknown as { chrome: unknown }).chrome = { runtime };

  return {
    sent,
    emit: (message) => {
      // The panel's trust gate reads `sender.id`; the routing gate reads
      // `sender.tab?.id` alongside the message's own `tabId`.
      const sender = {
        id: EXTENSION_ID,
        tab: { id: TAB_ID },
      } as unknown as chrome.runtime.MessageSender;
      for (const fn of [...listeners]) fn(message, sender);
    },
  };
}

/** jsdom ships no matchMedia; App reads it for the light/dark theme class. */
export function stubMatchMedia(): void {
  window.matchMedia = ((query: string) =>
    ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }) as unknown as MediaQueryList) as typeof window.matchMedia;
}

export function node(
  id: string,
  parentId: string | null,
  depth: number,
  role: string,
  name: string,
  childIds: string[] = [],
): [string, SemanticNode] {
  return [
    id,
    {
      id,
      parentId,
      childIds,
      depth,
      a11y: { role, name, description: "", states: {}, properties: {} },
      dom: { tagName: "div", attributes: {}, textContent: name },
      interaction: {
        actions: [],
        isEditable: false,
        focusable: role === "button",
      },
      ui: { expanded: true, selected: false, matchesFilter: true },
    } as unknown as SemanticNode,
  ];
}

export const TREE: [string, SemanticNode][] = [
  node("n1", null, 0, "document", "Page", ["n2"]),
  node("n2", "n1", 1, "group", "Toolbar", ["n3", "n4"]),
  node("n3", "n2", 2, "button", "Save"),
  node("n4", "n2", 2, "button", "Cancel"),
];

export function treeData(): ContentToPanel {
  return {
    type: "TREE_DATA",
    tabId: TAB_ID,
    payload: {
      nodes: TREE.map(([id, n]) => [id, structuredClone(n)]),
      rootId: "n1",
      pageTitle: "Test page",
      pageUrl: "https://example.test/",
    },
  } as unknown as ContentToPanel;
}
