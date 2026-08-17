/// <reference types="chrome" />

/**
 * Dev-only control surface for the `chrome.debugger` native dogfood (RFC PR H).
 * Rendered only in the DOGFOOD build (see main.tsx). Lets a dogfooder toggle
 * native mode, read Chromium's native tree over CDP, act on it, and export the
 * instrumentation report answering the banner / MV3-lifecycle / DevTools-conflict
 * questions. Deliberately self-contained — it lifts out cleanly if the verdict
 * is "no", and never touches the production side-panel App.
 */

import { useEffect, useRef, useState } from "preact/hooks";

import {
  blockedBy,
  explainUnavailable,
  type NativeUnavailableReason,
  type TabCapability,
} from "../native/capability.js";

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
  // What native can do on the active tab, or undefined while unknown. Asked
  // before attaching, so a `chrome://` tab is named as such instead of costing
  // a banner flash and an "attach-failed".
  const [capability, setCapability] = useState<TabCapability | undefined>(
    undefined,
  );

  useEffect(() => {
    void chrome.runtime
      .sendMessage({ type: "NATIVE_FLAG_GET" })
      .then((r: { enabled?: boolean }) => setEnabled(r?.enabled === true));
  }, []);

  /**
   * Re-ask what native can do here. Cheap (no attach), so it runs on mount, on
   * toggle, and whenever the user switches or navigates a tab.
   *
   * Sequenced: these fire from three sources that can overlap, and the replies
   * are not ordered. A late answer for the tab you just left would otherwise
   * stick — disabling the controls on a page where native works, which is the
   * exact friction this is meant to remove.
   */
  const capabilityRequest = useRef(0);
  async function refreshCapability(knownTabId?: number): Promise<void> {
    const token = ++capabilityRequest.current;
    // The caller passes the tab it already resolved. Resolving it a second time
    // in here let the pre-flight answer for one tab while the operation ran
    // against another — a user switching tabs during the round-trip could have
    // a `chrome://` tab classified and an ordinary one read, or the reverse.
    const tabId = knownTabId ?? (await activeTabId());
    if (token !== capabilityRequest.current) return;
    if (tabId === undefined) {
      setCapability(undefined);
      return;
    }
    const cap = (await chrome.runtime.sendMessage({
      type: "NATIVE_CAPABILITY",
      tabId,
    })) as TabCapability;
    if (token !== capabilityRequest.current) return;
    setCapability(cap);
  }

  /**
   * Record a refusal the service worker reported, but only if no newer question
   * has been asked since this operation started.
   *
   * Without the check, a late refusal describing the tab the user just left
   * pins its capability onto the tab they are now looking at — and if the
   * reason is one of the non-retryable ones, the Load button stays dead on a
   * page where native works, with nothing to re-enable it.
   */
  function noteRefusal(reason: NativeUnavailableReason, token: number): void {
    if (token !== capabilityRequest.current) return;
    setCapability(blockedBy(reason));
    setStatus(`native unavailable — ${explainUnavailable(reason)}`);
  }

  useEffect(() => {
    void refreshCapability();
    // Chrome fires these for the active-tab switch and for same-tab
    // navigation; both change the answer, and a stale "native unavailable"
    // banner is exactly the friction this PR exists to remove.
    const onActivated = (info: chrome.tabs.OnActivatedInfo) =>
      void refreshCapability(info.tabId);
    const onUpdated = (id: number, change: chrome.tabs.OnUpdatedInfo) => {
      if (!change.url) return;
      void (async () => {
        // onUpdated fires for EVERY tab, not just the visible one — a background
        // tab finishing a redirect would otherwise re-answer for a page the user
        // isn't looking at.
        if (id === (await activeTabId())) await refreshCapability(id);
      })();
    };
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => {
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, []);

  async function toggle() {
    const next = !enabled;
    const r = (await chrome.runtime.sendMessage({
      type: "NATIVE_FLAG_SET",
      enabled: next,
    })) as { detached?: number };
    setEnabled(next);
    if (next) {
      setStatus("native mode on — Load tree to attach");
      await refreshCapability();
      return;
    }
    forgetTree();
    // Drop the capability with the flag. Leaving it set kept an amber "native
    // unavailable here" panel on screen for a feature the user had just turned
    // off — and the banner is gated on `enabled` for the same reason.
    setCapability(undefined);
    // Report the detach count, ZERO INCLUDED: it is the only observable proof
    // the capability is gone, and a truthiness test hid exactly the answer the
    // normal case gives. A non-zero count is the interesting one — an MV3
    // suspend had stranded a live attachment, and its banner with it.
    setStatus(
      r?.detached === undefined
        ? "native mode off"
        : `native mode off — detached from ${r.detached} tab(s)`,
    );
  }

  /** Read the tree into state. Returns the node count, or null on failure.
   *  Does not touch `busy` — callers own that, so an action can refresh
   *  without releasing the lock in between. */
  async function readTreeInto(tabId: number): Promise<number | null> {
    const token = capabilityRequest.current;
    const r = (await chrome.runtime.sendMessage({
      type: "NATIVE_READ",
      tabId,
    })) as {
      ok?: boolean;
      error?: string;
      reason?: NativeUnavailableReason;
      nodes?: NativeNode[];
      url?: string;
    };
    if (!r?.ok) {
      forgetTree();
      // A capability refusal is not a failure to report as one — it is Chrome's
      // rule, and the useful output is what to do about it. The generic branch
      // stays for the genuine failures (a CDP command that broke mid-read).
      if (r?.reason) {
        noteRefusal(r.reason, token);
      } else {
        setStatus(`read failed: ${r?.error ?? "unknown"}`);
      }
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
    // Deliberately no pre-flight here. The service worker runs one before it
    // attaches, and it is the only place a refusal gets RECORDED — short-
    // circuiting here meant five of the eight reason codes could never reach
    // the Capability split at all, because the button is disabled for exactly
    // those five and this return skipped the read for the rest. It also spared
    // a duplicate capability round-trip per press.
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
    const token = capabilityRequest.current;
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
      })) as {
        success?: boolean;
        error?: string;
        reason?: NativeUnavailableReason;
      };
      if (!r?.success) {
        // Same split as the read path: a capability refusal (DevTools grabbed
        // the tab between the read and this click) gets the remedy, not a bare
        // error code.
        if (r?.reason) {
          noteRefusal(r.reason, token);
          return;
        }
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
      // Only overwrite the status when the re-read actually succeeded. On
      // failure `readTreeInto` has already put the useful thing there — if
      // DevTools was opened during the settle wait, that is the conflict
      // remedy, and clobbering it with "could not refresh the tree" throws away
      // the one message that tells the user what to do. `loadTree` guards the
      // identical call the same way.
      if (count !== null) {
        setStatus(`acted on ${node.role} — tree refreshed (${count} nodes)`);
      } else if (capabilityRequest.current !== token) {
        // `readTreeInto`'s refusal branch is itself token-gated, so when the
        // click navigated the page (bumping the token) nothing set a status —
        // leaving an empty tree under a stale "read N nodes" line.
        setStatus(`acted on ${node.role} — the page changed; reload the tree`);
      }
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
        {/*
          Deliberately NOT disabled on an unattachable tab. Disabling it was the
          second door that kept five of the eight reason codes out of the
          Capability split: no press, no NATIVE_READ, no recorded refusal — and
          that split is the number the verdict is read from. Pressing costs
          nothing now, because the service worker refuses before it attaches, so
          there is no banner flash to protect against. The amber panel above
          already says the press will be refused and why.
        */}
        <button onClick={loadTree} disabled={!enabled || busy}>
          {busy ? "working…" : "Load native tree"}
        </button>
        <button onClick={copyReport}>Copy dogfood report</button>
        <button onClick={clearLog}>Clear log</button>
      </div>
      {enabled && capability && !capability.native && (
        <div style="margin:6px 0;padding:4px 6px;border-left:3px solid #b45309;background:#fef3c7">
          <strong>native unavailable here</strong> —{" "}
          {explainUnavailable(capability.reason!)}
          {capability.domFallback && (
            <>
              {" "}
              The tab-order view is DOM-based and is unaffected either way — it
              never used native.
            </>
          )}
        </div>
      )}
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
                  disabled={busy || !enabled}
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
