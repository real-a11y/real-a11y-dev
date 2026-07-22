/**
 * SPIKE — CDP action dispatch against nodes from the native AX tree.
 *
 * Phase 2 of the native-tree RFC: can we click/type after reading via
 * getFullAXTree, using backendDOMNodeId → DOM.resolveNode → Runtime / Input?
 *
 * Not a public API. Proves author-DOM actions work; documents UA-shadow limits.
 */

import type { CDPSession, Page } from "playwright";

import type { SpikeAXNode } from "./normalize.js";

export interface DispatchResult {
  success: boolean;
  error?: string;
  /** How we targeted the node, for the spike report. */
  path?: "runtime-call" | "unresolved" | "no-backend-id";
}

async function resolveObjectId(
  client: CDPSession,
  backendDOMNodeId: number,
): Promise<string | null> {
  await client.send("DOM.enable");
  await client.send("DOM.getDocument", { depth: 0 });
  try {
    const resolved = (await client.send("DOM.resolveNode", {
      backendNodeId: backendDOMNodeId,
    })) as { object?: { objectId?: string } };
    return resolved.object?.objectId ?? null;
  } catch {
    return null;
  }
}

/**
 * Click the DOM element behind an AX node's backendDOMNodeId.
 * Uses Runtime.callFunctionOn → element.click() (simple path).
 * Alternative (not spiked here): DOM.getBoxModel + Input.dispatchMouseEvent
 * for pages that ignore programmatic click().
 */
export async function cdpClick(
  client: CDPSession,
  ax: SpikeAXNode,
): Promise<DispatchResult> {
  if (typeof ax.backendDOMNodeId !== "number") {
    return {
      success: false,
      error: "AX node has no backendDOMNodeId",
      path: "no-backend-id",
    };
  }
  const objectId = await resolveObjectId(client, ax.backendDOMNodeId);
  if (!objectId) {
    return {
      success: false,
      error: `DOM.resolveNode failed for backendDOMNodeId=${ax.backendDOMNodeId}`,
      path: "unresolved",
    };
  }
  try {
    await client.send("Runtime.callFunctionOn", {
      objectId,
      functionDeclaration: `function () {
        if (typeof this.click === "function") {
          this.click();
          return { ok: true, tag: this.tagName || null };
        }
        return { ok: false, reason: "no click()" };
      }`,
      returnByValue: true,
    });
    return { success: true, path: "runtime-call" };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      path: "runtime-call",
    };
  }
}

/**
 * Type into an author-DOM input/textarea resolved from an AX node.
 * Mirrors core ActionDispatcher: prototype value setter + input/change events,
 * executed in-page via Runtime.callFunctionOn.
 */
export async function cdpType(
  client: CDPSession,
  ax: SpikeAXNode,
  value: string,
): Promise<DispatchResult> {
  if (typeof ax.backendDOMNodeId !== "number") {
    return {
      success: false,
      error: "AX node has no backendDOMNodeId",
      path: "no-backend-id",
    };
  }
  const objectId = await resolveObjectId(client, ax.backendDOMNodeId);
  if (!objectId) {
    return {
      success: false,
      error: `DOM.resolveNode failed for backendDOMNodeId=${ax.backendDOMNodeId}`,
      path: "unresolved",
    };
  }
  try {
    const evaled = (await client.send("Runtime.callFunctionOn", {
      objectId,
      functionDeclaration: `function (text) {
        const el = this;
        if (!el || !el.tagName) return { ok: false, reason: "not-element" };
        const tag = el.tagName.toLowerCase();
        if (tag !== "input" && tag !== "textarea") {
          return { ok: false, reason: "not-text-field", tag: el.tagName };
        }
        const proto =
          tag === "textarea"
            ? window.HTMLTextAreaElement.prototype
            : window.HTMLInputElement.prototype;
        const desc = Object.getOwnPropertyDescriptor(proto, "value");
        if (desc && desc.set) desc.set.call(el, text);
        else el.value = text;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return { ok: true, value: el.value, tag: el.tagName };
      }`,
      arguments: [{ value }],
      returnByValue: true,
    })) as { result?: { value?: { ok?: boolean; reason?: string } } };
    const result = evaled.result?.value;
    if (!result?.ok) {
      return {
        success: false,
        error: result?.reason ?? "type failed",
        path: "runtime-call",
      };
    }
    return { success: true, path: "runtime-call" };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      path: "runtime-call",
    };
  }
}

/** Find first non-ignored AX node matching role + optional name substring. */
export function findAx(
  nodes: SpikeAXNode[],
  role: string,
  nameIncludes?: string,
): SpikeAXNode | undefined {
  return nodes.find((n) => {
    if (n.ignored) return false;
    if ((n.role?.value ?? "") !== role) return false;
    if (nameIncludes === undefined) return true;
    return (n.name?.value ?? "")
      .toLowerCase()
      .includes(nameIncludes.toLowerCase());
  });
}

/** Open a CDP session, enable Accessibility, return nodes + client. */
export async function openAxSession(page: Page): Promise<{
  client: CDPSession;
  nodes: SpikeAXNode[];
}> {
  const client = await page.context().newCDPSession(page);
  await client.send("Accessibility.enable");
  const full = (await client.send("Accessibility.getFullAXTree")) as {
    nodes: SpikeAXNode[];
  };
  return { client, nodes: full.nodes };
}
