/**
 * Transport-agnostic native-tree core for the extension's `chrome.debugger`
 * dogfood mode (RFC PR H).
 *
 * Everything that reads / normalizes / acts on Chromium's native AX tree is
 * written against a 1-method `CdpTransport`, so the exact same code runs over
 * `chrome.debugger.sendCommand` (this extension) and Playwright's `CDPSession`
 * (`@real-a11y-dev/browser`). Vocabulary (which nodes survive, sibling order,
 * role map, name promotion) comes from `@real-a11y-dev/core`'s shared
 * `normalizeNativeAX` — the one versioned module (RFC R4); this file adds only
 * the transport plumbing, mirroring the browser producer.
 *
 * Redaction discipline (R1) matches the browser side: a value typed into a
 * field never crosses back out — the in-page function returns only a structural
 * marker, and errors are content-free.
 */

import {
  normalizeNativeAX,
  serializeNativeAX,
  type NativeAXNode,
  type RawNativeAXNode,
} from "@real-a11y-dev/core";

/** The single capability the native path needs from any CDP transport. */
export interface CdpTransport {
  send<T = unknown>(method: string, params?: object): Promise<T>;
}

export interface NativeTreeResult {
  /** Normalized nodes (shared core vocabulary), document order. */
  nodes: NativeAXNode[];
  /** Indented `role "name"` serialization, identical grammar to the DOM tree. */
  serialized: string;
  /** Raw AX node count before normalization — a dogfood size signal. */
  rawCount: number;
}

/** Read + normalize the whole native AX tree over any CDP transport. */
export async function readNativeTree(
  transport: CdpTransport,
): Promise<NativeTreeResult> {
  await transport.send("Accessibility.enable");
  const full = await transport.send<{ nodes: RawNativeAXNode[] }>(
    "Accessibility.getFullAXTree",
  );
  const nodes = normalizeNativeAX(full.nodes);
  return {
    nodes,
    serialized: serializeNativeAX(nodes),
    rawCount: full.nodes.length,
  };
}

/** Actions the native backend can dispatch. Others are refused, not guessed. */
export type NativeAction = "click" | "type" | "focus";

export interface NativeDispatchResult {
  success: boolean;
  /** Content-free reason string only — never page text (R1/R6 invariant). */
  error?: string;
}

/**
 * A normalized native node's id encodes its Chromium `backendDOMNodeId`
 * (`ax-dom-<n>`) when a DOM element backs it. Parse it back, or `null` for
 * `ax-<n>` (no backing DOM element — a synthesized root or UA-internal node).
 * Kept identical to `@real-a11y-dev/browser`'s `backendNodeIdFrom`.
 */
export function backendNodeIdFrom(nodeId: string): number | null {
  const m = /^ax-dom-(\d+)$/.exec(nodeId);
  return m ? Number(m[1]) : null;
}

const SUPPORTED = new Set<NativeAction>(["click", "type", "focus"]);

/**
 * Dispatch a click / type / focus against a native node over any CDP transport.
 * Resolves the node's backend id to a live DOM element (`DOM.resolveNode`) and
 * runs the action in-page (`Runtime.callFunctionOn`). The typed value is passed
 * INTO the page but never returned; failures surface as static reason strings.
 */
export async function dispatchNative(
  transport: CdpTransport,
  nodeId: string,
  action: NativeAction,
  value?: string,
): Promise<NativeDispatchResult> {
  if (!SUPPORTED.has(action)) {
    return { success: false, error: `unsupported action "${action}"` };
  }
  const backendNodeId = backendNodeIdFrom(nodeId);
  if (backendNodeId === null) {
    return { success: false, error: "node has no backing DOM element" };
  }
  if (action === "type" && typeof value !== "string") {
    return {
      success: false,
      error: 'the "type" action requires a string value',
    };
  }

  let objectId: string | undefined;
  try {
    await transport.send("DOM.enable");
    const resolved = await transport.send<{ object?: { objectId?: string } }>(
      "DOM.resolveNode",
      { backendNodeId },
    );
    objectId = resolved.object?.objectId;
  } catch {
    return {
      success: false,
      error: "could not resolve node — re-read the tree",
    };
  }
  if (!objectId) {
    return {
      success: false,
      error: "could not resolve node — re-read the tree",
    };
  }

  try {
    const marker = await runInPage(transport, objectId, action, value);
    if (marker?.ok) return { success: true };
    return { success: false, error: marker?.reason ?? "action failed" };
  } catch {
    return {
      success: false,
      error: "the action could not be dispatched over CDP",
    };
  }
}

type Marker = { ok?: boolean; reason?: string };

/** Run the action's in-page function; returns only a structural marker. */
async function runInPage(
  transport: CdpTransport,
  objectId: string,
  action: NativeAction,
  value?: string,
): Promise<Marker | undefined> {
  const fns: Record<NativeAction, string> = {
    click: `function () {
      if (typeof this.click !== "function") return { ok: false, reason: "not-clickable" };
      this.click();
      return { ok: true };
    }`,
    focus: `function () {
      if (typeof this.focus !== "function") return { ok: false, reason: "not-focusable" };
      this.focus();
      return { ok: true };
    }`,
    // The value goes IN as an argument; the element's .value never comes back.
    type: `function (text) {
      const el = this;
      if (!el || !el.tagName) return { ok: false, reason: "not-element" };
      const tag = el.tagName.toLowerCase();
      if (tag === "input" || tag === "textarea") {
        const proto = tag === "textarea"
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
        const desc = Object.getOwnPropertyDescriptor(proto, "value");
        if (desc && desc.set) desc.set.call(el, text); else el.value = text;
      } else if (el.isContentEditable) {
        el.textContent = text;
      } else {
        return { ok: false, reason: "not-a-text-field" };
      }
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true };
    }`,
  };
  const res = await transport.send<{ result?: { value?: Marker } }>(
    "Runtime.callFunctionOn",
    {
      objectId,
      functionDeclaration: fns[action],
      returnByValue: true,
      ...(action === "type" ? { arguments: [{ value }] } : {}),
    },
  );
  return res.result?.value;
}

/** First normalized node matching role + optional accessible-name substring. */
export function findNative(
  nodes: NativeAXNode[],
  role: string,
  nameIncludes?: string,
): NativeAXNode | undefined {
  return nodes.find(
    (n) =>
      n.role === role &&
      (nameIncludes === undefined ||
        n.name.toLowerCase().includes(nameIncludes.toLowerCase())),
  );
}
