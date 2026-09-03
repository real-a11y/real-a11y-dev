/// <reference types="chrome" />

/**
 * Dev-only control surface for the `chrome.debugger` native dogfood (RFC PR H).
 * Rendered only in the DOGFOOD build (see main.tsx). Lets a dogfooder toggle
 * native mode, read Chromium's native tree over CDP, act on it, and export the
 * instrumentation report answering the banner / MV3-lifecycle / DevTools-conflict
 * questions. Deliberately self-contained — it lifts out cleanly if the verdict
 * is "no", and never touches the production side-panel App.
 */

import { useEffect, useState } from "preact/hooks";

// Roles worth offering a one-click action for during a dogfood session.
const ACTABLE = new Set([
  "button",
  "link",
  "checkbox",
  "radio",
  "switch",
  "tab",
  "menuitem",
  "textbox",
  "combobox",
]);

type NativeNode = { id: string; role: string; name: string; depth: number };

/**
 * How long to let the page react before re-reading the tree after an action.
 * Long enough for microtask/animation-frame batching and a typical menu
 * transition; short enough that the panel still feels immediate. A crude timer
 * rather than a quiescence signal on purpose — this is a dev harness, and
 * plumbing a MutationObserver through CDP would cost more than the verdict
 * needs. Its limit (slow, fetch-driven re-renders) is called out in DOGFOOD.md.
 */
const SETTLE_MS = 250;

async function activeTabId(): Promise<number | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

/** Best-effort current URL for a tab; undefined means "can't tell". */
async function tabUrl(tabId: number): Promise<string | undefined> {
  try {
    return (await chrome.tabs.get(tabId)).url;
  } catch {
    return undefined;
  }
}

export function DogfoodPanel() {
  const [enabled, setEnabled] = useState(false);
  const [nodes, setNodes] = useState<NativeNode[]>([]);
  const [status, setStatus] = useState("native mode is off");
  // The tab the current tree was read from. Native node ids encode Chromium
  // `backendDOMNodeId`s, which are scoped to that tab's document — dispatching
  // one anywhere else would act on an unrelated element in a different page.
  const [treeTabId, setTreeTabId] = useState<number | undefined>(undefined);
  // The document the tree was read from. A navigation invalidates every id in
  // it, so this is what makes "stale" detectable rather than silent.
  const [treeUrl, setTreeUrl] = useState<string | undefined>(undefined);
  // A debugger operation is in flight. The service worker queues per tab, so a
  // second request is correct-but-slow rather than harmful — but leaving the
  // buttons live invites a double-click that reads the tree twice or dispatches
  // an action twice, both of which land in the dogfood numbers.
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void chrome.runtime
      .sendMessage({ type: "NATIVE_FLAG_GET" })
      .then((r: { enabled?: boolean }) => setEnabled(r?.enabled === true));
  }, []);

  async function toggle() {
    const next = !enabled;
    await chrome.runtime.sendMessage({
      type: "NATIVE_FLAG_SET",
      enabled: next,
    });
    setEnabled(next);
    setStatus(
      next ? "native mode on — Load tree to attach" : "native mode off",
    );
    if (!next) forgetTree();
  }

  /** Read the tree into state. Returns the node count, or null on failure.
   *  Does not touch `busy` — callers own that, so an action can refresh
   *  without releasing the lock in between. */
  async function readTreeInto(tabId: number): Promise<number | null> {
    const r = (await chrome.runtime.sendMessage({
      type: "NATIVE_READ",
      tabId,
    })) as {
      ok?: boolean;
      error?: string;
      nodes?: NativeNode[];
      url?: string;
    };
    if (!r?.ok) {
      forgetTree();
      setStatus(`read failed: ${r?.error ?? "unknown"}`);
      return null;
    }
    setNodes(r.nodes ?? []);
    setTreeTabId(tabId);
    setTreeUrl(r.url);
    return r.nodes?.length ?? 0;
  }

  function forgetTree() {
    setNodes([]);
    setTreeTabId(undefined);
    setTreeUrl(undefined);
  }

  async function loadTree() {
    if (busy) return;
    const tabId = await activeTabId();
    if (tabId === undefined) return setStatus("no active tab");
    setBusy(true);
    setStatus("attaching debugger + reading…");
    try {
      const count = await readTreeInto(tabId);
      if (count !== null) setStatus(`read ${count} nodes`);
    } finally {
      setBusy(false);
    }
  }

  async function act(node: NativeNode) {
    if (busy) return;
    // Dispatch against the tab the tree came from, and refuse if the user has
    // since switched away: these ids only mean something in that document, so
    // acting on the new active tab would click a different page's element.
    if (treeTabId === undefined) return setStatus("load a tree first");
    const current = await activeTabId();
    if (current !== treeTabId) {
      forgetTree();
      return setStatus("active tab changed — reload the native tree");
    }
    const tabId = treeTabId;
    // A navigation replaces the document, and with it every backendDOMNodeId
    // these ids are built from — so acting now would target whatever happens
    // to hold that id in the new page, or nothing at all. Refuse rather than
    // dispatch into the dark. (Undefined URL = can't tell; don't block.)
    const nowUrl = await tabUrl(tabId);
    if (treeUrl && nowUrl && nowUrl !== treeUrl) {
      forgetTree();
      return setStatus("page navigated — reload the native tree");
    }
    const isText = node.role === "textbox" || node.role === "combobox";
    const value = isText
      ? prompt(`Type into "${node.name || node.role}":`)
      : undefined;
    if (isText && value === null) return; // cancelled
    setBusy(true);
    try {
      const r = (await chrome.runtime.sendMessage({
        type: "NATIVE_ACT",
        tabId,
        nodeId: node.id,
        action: isText ? "type" : "click",
        ...(isText ? { value } : {}),
      })) as { success?: boolean; error?: string };
      if (!r?.success) {
        return setStatus(`act failed: ${r?.error ?? "unknown"}`);
      }
      // Re-read before the next action. A click that opens a menu, expands a
      // row or re-renders a list invalidates the backendDOMNodeIds every id
      // here is built from, so the tree goes stale the instant it works —
      // session 1 lost 17 of 18 clicks to exactly that, each one dispatched
      // against an id the page had already discarded.
      //
      // Settle first: dispatch returns when the in-page function returns, which
      // is *before* the page has reacted. Reading immediately can capture the
      // pre-action DOM and call it fresh — the same staleness, now with a
      // reassuring status line. This covers microtask/rAF batching and short
      // CSS transitions; it does NOT cover a fetch-driven re-render, which
      // stays a known limitation to watch during the dogfood.
      await new Promise((r) => setTimeout(r, SETTLE_MS));
      const count = await readTreeInto(tabId);
      setStatus(
        count === null
          ? `acted on ${node.role} — could not refresh the tree`
          : `acted on ${node.role} — tree refreshed (${count} nodes)`,
      );
    } finally {
      setBusy(false);
    }
  }

  async function copyReport() {
    const r = (await chrome.runtime.sendMessage({
      type: "NATIVE_DOGFOOD_REPORT",
    })) as { report?: string };
    await navigator.clipboard.writeText(r?.report ?? "(empty)");
    setStatus("dogfood report copied to clipboard");
  }

  async function clearLog() {
    await chrome.runtime.sendMessage({ type: "NATIVE_DOGFOOD_CLEAR" });
    setStatus("dogfood log cleared");
  }

  return (
    <details style="border:1px solid #b45309;background:#fffbeb;color:#7c2d12;font:12px/1.4 system-ui;padding:6px 8px;margin:4px">
      <summary style="cursor:pointer;font-weight:600">
        ⚠︎ chrome.debugger native mode — DEV dogfood
      </summary>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:6px 0">
        <label>
          <input type="checkbox" checked={enabled} onChange={toggle} /> native
          mode
        </label>
        <button onClick={loadTree} disabled={!enabled || busy}>
          {busy ? "working…" : "Load native tree"}
        </button>
        <button onClick={copyReport}>Copy dogfood report</button>
        <button onClick={clearLog}>Clear log</button>
      </div>
      <div style="opacity:0.8">{status}</div>
      {nodes.length > 0 && (
        <div style="max-height:220px;overflow:auto;margin-top:6px;font-family:ui-monospace,monospace">
          {nodes.map((n) => {
            const label = `${"  ".repeat(n.depth)}${n.role}${n.name ? ` "${n.name}"` : ""}`;
            return ACTABLE.has(n.role) ? (
              <div key={n.id}>
                <button
                  style="text-align:left;width:100%;white-space:pre"
                  onClick={() => act(n)}
                  disabled={busy}
                >
                  {label}
                </button>
              </div>
            ) : (
              <div key={n.id} style="white-space:pre;padding:0 2px">
                {label}
              </div>
            );
          })}
        </div>
      )}
    </details>
  );
}
