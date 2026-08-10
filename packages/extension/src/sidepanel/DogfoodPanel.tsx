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

async function activeTabId(): Promise<number | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

export function DogfoodPanel() {
  const [enabled, setEnabled] = useState(false);
  const [nodes, setNodes] = useState<NativeNode[]>([]);
  const [status, setStatus] = useState("native mode is off");
  // The tab the current tree was read from. Native node ids encode Chromium
  // `backendDOMNodeId`s, which are scoped to that tab's document — dispatching
  // one anywhere else would act on an unrelated element in a different page.
  const [treeTabId, setTreeTabId] = useState<number | undefined>(undefined);

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
    if (!next) {
      setNodes([]);
      setTreeTabId(undefined);
    }
  }

  async function loadTree() {
    const tabId = await activeTabId();
    if (tabId === undefined) return setStatus("no active tab");
    setStatus("attaching debugger + reading…");
    const r = (await chrome.runtime.sendMessage({
      type: "NATIVE_READ",
      tabId,
    })) as { ok?: boolean; error?: string; nodes?: NativeNode[] };
    if (!r?.ok) {
      setNodes([]);
      setTreeTabId(undefined);
      return setStatus(`read failed: ${r?.error ?? "unknown"}`);
    }
    setNodes(r.nodes ?? []);
    setTreeTabId(tabId);
    setStatus(`read ${r.nodes?.length ?? 0} nodes`);
  }

  async function act(node: NativeNode) {
    // Dispatch against the tab the tree came from, and refuse if the user has
    // since switched away: these ids only mean something in that document, so
    // acting on the new active tab would click a different page's element.
    if (treeTabId === undefined) return setStatus("load a tree first");
    const current = await activeTabId();
    if (current !== treeTabId) {
      setNodes([]);
      setTreeTabId(undefined);
      return setStatus("active tab changed — reload the native tree");
    }
    const tabId = treeTabId;
    const isText = node.role === "textbox" || node.role === "combobox";
    const value = isText
      ? prompt(`Type into "${node.name || node.role}":`)
      : undefined;
    if (isText && value === null) return; // cancelled
    const r = (await chrome.runtime.sendMessage({
      type: "NATIVE_ACT",
      tabId,
      nodeId: node.id,
      action: isText ? "type" : "click",
      ...(isText ? { value } : {}),
    })) as { success?: boolean; error?: string };
    setStatus(
      r?.success
        ? `acted on ${node.role}`
        : `act failed: ${r?.error ?? "unknown"}`,
    );
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
        <button onClick={loadTree} disabled={!enabled}>
          Load native tree
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
