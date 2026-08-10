/**
 * Transport-agnostic native-tree core for the extension's `chrome.debugger`
 * dogfood mode (RFC PR H).
 *
 * Everything that reads / normalizes / acts on Chromium's native AX tree is
 * written against a 1-method `CdpTransport`, so this code runs unchanged over
 * `chrome.debugger.sendCommand` (this extension) and Playwright's `CDPSession`
 * (`@real-a11y-dev/browser`). Vocabulary (which nodes survive, sibling order,
 * role map, name promotion) comes from `@real-a11y-dev/core`'s shared
 * `normalizeNativeAX` — the one versioned module (RFC R4); this file adds only
 * the transport plumbing, mirroring the browser producer.
 *
 * The **read** path is genuinely shared through that core module. The **action**
 * path is not, and cannot be: those functions cross into the page as source
 * text, so they are a deliberate, tested mirror of `browser`'s `page-actions.ts`
 * rather than an import — see the block comment above `pageClick` for why, and
 * the tests that pin the behaviour.
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

/* eslint-disable @typescript-eslint/no-this-alias --
 * `Runtime.callFunctionOn` invokes these with the target element as `this`, so
 * the element genuinely arrives that way. The local alias is not stylistic:
 * TypeScript narrows a `const` (`el instanceof HTMLInputElement`) but will not
 * narrow `this`, and the type path depends on that narrowing to keep a custom
 * element away from the native value setter. */

/*
 * ── The functions that run INSIDE the page ──────────────────────────────────
 *
 * Each is serialized with `String(fn)` and handed to `Runtime.callFunctionOn`
 * as SOURCE TEXT, not a closure. Everything a function needs must live in its
 * own body: no imports, no module-scope constants, no shared helpers. That is
 * why the composite-role list is declared inside the function rather than
 * hoisted — hoisting produces a `ReferenceError` in the page, not a compile
 * error here. Writing them as real functions (rather than template strings) is
 * what gets them type-checked and linted at all.
 *
 * **Deliberate mirror.** These mirror `@real-a11y-dev/browser`'s
 * `page-actions.ts`, which in turn mirrors core's in-page `ActionDispatcher`.
 * The serialization constraint is what forces a copy instead of an import, and
 * neither original is reachable here: `browser` carries Playwright (no good in
 * an MV3 worker), and core's dispatcher lives *in the page* — precisely what
 * the native path deliberately works without. Sharing via `core` was measured
 * and rejected: core sits ~30 bytes under its gzip budget.
 *
 * The behaviour is not arbitrary — it was earned on real pages. A bare
 * `element.click()` fires `click` alone and silently no-ops on jsaction/Material
 * handlers that gate on a pointer sequence; a click on a composite-widget
 * wrapper misses the delegated handler, which walks *upward* from the target.
 * A raw `textContent` write loses to model-driven editors (ProseMirror, Lexical,
 * Draft), which consume `beforeinput` and then revert the DOM underneath.
 *
 * R1: a marker carries structure only — never the typed text or the element's
 * resulting value.
 */

/** Click the way a real pointer does, redirecting composite wrappers. */
export function pageClick(this: Element): Marker {
  const el = this;
  if (!el || !el.tagName) return { ok: false, reason: "not-element" };

  // Composite-widget children are commonly containers wrapping the real
  // control. querySelector returns document order — the row's primary action,
  // not an inner chevron. Well-formed ARIA matches nothing and the wrapper is
  // used unchanged.
  let target: Element = el;
  const role = el.getAttribute("role") || "";
  const composite = [
    "treeitem",
    "menuitem",
    "menuitemcheckbox",
    "menuitemradio",
    "option",
    "tab",
    "row",
    "gridcell",
    "cell",
  ];
  if (composite.indexOf(role) !== -1) {
    const inner = el.querySelector(
      '[role="link"], [role="button"], a[href], button',
    );
    if (inner) target = inner;
  }

  const base = { bubbles: true, cancelable: true, composed: true, button: 0 };
  const pointer = {
    bubbles: true,
    cancelable: true,
    composed: true,
    button: 0,
    pointerType: "mouse",
    isPrimary: true,
  };
  target.dispatchEvent(new PointerEvent("pointerdown", pointer));
  target.dispatchEvent(new MouseEvent("mousedown", base));
  target.dispatchEvent(new PointerEvent("pointerup", pointer));
  target.dispatchEvent(new MouseEvent("mouseup", base));
  target.dispatchEvent(new MouseEvent("click", base));
  return { ok: true };
}

/** Move real keyboard focus. */
export function pageFocus(this: Element): Marker {
  const el = this;
  if (!el || !el.tagName) return { ok: false, reason: "not-element" };
  const focusable = el as HTMLElement;
  if (typeof focusable.focus !== "function") {
    return { ok: false, reason: "not-focusable" };
  }
  focusable.focus();
  return { ok: true };
}

/** Replace a field's value; the text goes IN but never comes back out. */
export function pageType(this: Element, text: string): Marker {
  const el = this;
  if (!el || !el.tagName) return { ok: false, reason: "not-element" };
  // `instanceof` (not a tagName check) keeps a custom element from ever
  // reaching a native setter — the setters brand-check their receiver and
  // throw on the wrong element type.
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const proto =
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
    if (descriptor && descriptor.set) descriptor.set.call(el, text);
    else el.value = text;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true };
  }

  const editable = el as HTMLElement;
  const editableAttr = editable.getAttribute("contenteditable");
  const isEditable =
    editable.isContentEditable === true ||
    editableAttr === "" ||
    editableAttr === "true" ||
    editableAttr === "plaintext-only";
  if (isEditable) {
    // Model-driven editors consume this and insert into their own document
    // model; writing textContent anyway would be reverted underneath us.
    const notHandled = editable.dispatchEvent(
      new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        inputType: "insertText",
        data: text,
      }),
    );
    if (notHandled) {
      editable.textContent = text;
      editable.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          inputType: "insertText",
          data: text,
        }),
      );
    }
    return { ok: true };
  }

  return { ok: false, reason: "not-a-text-field" };
}

/* eslint-enable @typescript-eslint/no-this-alias */

/** The in-page source for each action, as `Runtime.callFunctionOn` wants it. */
export const IN_PAGE_ACTION_SOURCE: Record<NativeAction, string> = {
  click: String(pageClick),
  focus: String(pageFocus),
  type: String(pageType),
};

/** Run the action's in-page function; returns only a structural marker. */
async function runInPage(
  transport: CdpTransport,
  objectId: string,
  action: NativeAction,
  value?: string,
): Promise<Marker | undefined> {
  const res = await transport.send<{ result?: { value?: Marker } }>(
    "Runtime.callFunctionOn",
    {
      objectId,
      functionDeclaration: IN_PAGE_ACTION_SOURCE[action],
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
